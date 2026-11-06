"""
VYZN Billing & Camera Quota Management Engine.
Handles camera quota lifecycle, manual UPI orders, 12-digit UTR validation,
admin approvals, idempotency, audit logging, and Telegram notifications.
"""

from __future__ import annotations
import os
import re
import time
import uuid
import json
import secrets
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple

import requests
from vyzn.billing.provider import get_payment_provider

logger = logging.getLogger("vyzn.billing")

# Configurable constants
CAMERA_PRICE_PAISE_DEFAULT = 249900  # ₹2,499 per camera
MAX_CAMERAS_PER_ORDER_DEFAULT = 20
ORDER_EXPIRY_MINUTES_DEFAULT = 30

# In-memory stores for instant performance and offline/serverless resilience
_MEM_QUOTA: Dict[str, int] = {}
_MEM_ORDERS: Dict[str, Dict[str, Any]] = {}
_MEM_AUDIT: List[Dict[str, Any]] = []
_RATE_LIMIT_STORE: Dict[str, List[float]] = {}
_BILLING_LOCK = threading.RLock()


def get_config_value(key: str, default: Any) -> Any:
    """Reads configuration from config/config.json or environment."""
    cfg_file = os.path.join("config", "config.json")
    if os.path.exists(cfg_file):
        try:
            with open(cfg_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                b_cfg = cfg.get("billing", {})
                if key in b_cfg:
                    return b_cfg[key]
        except Exception:
            pass
    env_key = key.upper()
    if env_key in os.environ:
        val = os.environ[env_key]
        if isinstance(default, bool):
            return val.lower() in ("true", "1", "yes")
        if isinstance(default, int):
            try:
                return int(val)
            except ValueError:
                return default
        return val
    return default


def get_camera_price_paise() -> int:
    return int(get_config_value("price_per_camera_paise", CAMERA_PRICE_PAISE_DEFAULT))


def get_max_cameras_per_order() -> int:
    return int(get_config_value("max_cameras_per_order", MAX_CAMERAS_PER_ORDER_DEFAULT))


def get_order_expiry_minutes() -> int:
    return int(get_config_value("order_expiry_minutes", ORDER_EXPIRY_MINUTES_DEFAULT))


def is_billing_enforced() -> bool:
    env_val = os.environ.get("BILLING_ENFORCEMENT", "false").lower()
    return env_val in ("true", "1", "yes")


def get_admin_user_ids() -> List[str]:
    raw = os.environ.get("ADMIN_USER_IDS", "usr_d40aa734b4b1,tapise.utkarsh@gmail.com")
    return [x.strip().lower() for x in raw.split(",") if x.strip()]


def is_admin_user(user: Optional[Dict[str, Any]]) -> bool:
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    admin_ids = get_admin_user_ids()
    uid = str(user.get("id") or "").lower()
    email = str(user.get("email") or "").lower()
    return uid in admin_ids or email in admin_ids


# -----------------------------------------------------------------------------
# Supabase Integration Helpers
# -----------------------------------------------------------------------------

def _get_supabase_headers() -> Optional[Tuple[str, Dict[str, str]]]:
    url = (os.environ.get("VYZN_SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = (os.environ.get("VYZN_SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        return None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    return url, headers


def _sync_quota_from_supabase(tenant_id: str) -> Optional[int]:
    sb = _get_supabase_headers()
    if not sb:
        return None
    url, headers = sb
    try:
        r = requests.get(f"{url}/rest/v1/camera_quota?tenant_id=eq.{tenant_id}&select=*", headers=headers, timeout=3.5)
        if r.status_code == 200:
            rows = r.json()
            if rows:
                purchased = int(rows[0].get("purchased", 0))
                _MEM_QUOTA[tenant_id] = purchased
                return purchased
    except Exception as e:
        logger.warning(f"Error fetching quota from Supabase: {e}")
    return None


def _sync_quota_to_supabase(tenant_id: str, purchased: int) -> None:
    _MEM_QUOTA[tenant_id] = purchased
    sb = _get_supabase_headers()
    if not sb:
        return
    url, headers = sb
    payload = {
        "tenant_id": tenant_id,
        "purchased": purchased,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    try:
        headers["x-upsert"] = "true"
        requests.post(f"{url}/rest/v1/camera_quota", json=payload, headers=headers, timeout=4.0)
    except Exception as e:
        logger.warning(f"Error writing quota to Supabase: {e}")


def _sync_order_to_supabase(order: Dict[str, Any]) -> None:
    _MEM_ORDERS[order["id"]] = dict(order)
    sb = _get_supabase_headers()
    if not sb:
        return
    url, headers = sb
    try:
        headers["x-upsert"] = "true"
        requests.post(f"{url}/rest/v1/quota_orders", json=order, headers=headers, timeout=4.0)
    except Exception as e:
        logger.warning(f"Error writing quota order to Supabase: {e}")


def _sync_audit_to_supabase(audit_row: Dict[str, Any]) -> None:
    _MEM_AUDIT.append(dict(audit_row))
    sb = _get_supabase_headers()
    if not sb:
        return
    url, headers = sb
    try:
        requests.post(f"{url}/rest/v1/payment_audit", json=audit_row, headers=headers, timeout=3.5)
    except Exception as e:
        logger.warning(f"Error writing audit row to Supabase: {e}")


# -----------------------------------------------------------------------------
# Core Quota Logic
# -----------------------------------------------------------------------------

def get_tenant_purchased_quota(tenant_id: str, default_used: int = 0) -> int:
    """
    Returns purchased camera quota for tenant.
    Backfills automatically if tenant record does not exist yet.
    """
    with _BILLING_LOCK:
        if tenant_id in _MEM_QUOTA:
            return _MEM_QUOTA[tenant_id]

        cloud_val = _sync_quota_from_supabase(tenant_id)
        if cloud_val is not None:
            return cloud_val

        # Backfill for existing tenants so nothing breaks
        initial = max(default_used, 1)
        _sync_quota_to_supabase(tenant_id, initial)
        return initial


def get_quota_overview(tenant_id: str, used_count: int) -> Dict[str, Any]:
    """Computes purchased, used, and available quota."""
    purchased = get_tenant_purchased_quota(tenant_id, default_used=used_count)
    available = max(purchased - used_count, 0)
    return {
        "purchased": purchased,
        "used": used_count,
        "available": available,
        "price_per_camera_paise": get_camera_price_paise(),
        "max_per_order": get_max_cameras_per_order()
    }


def check_rate_limit(key: str, max_attempts: int = 5, window_sec: int = 60) -> bool:
    """Rate limits sensitive submissions per key (IP or user ID)."""
    now = time.time()
    with _BILLING_LOCK:
        history = _RATE_LIMIT_STORE.get(key, [])
        history = [t for t in history if now - t < window_sec]
        if len(history) >= max_attempts:
            _RATE_LIMIT_STORE[key] = history
            return False
        history.append(now)
        _RATE_LIMIT_STORE[key] = history
        return True


def expire_stale_orders() -> None:
    """Checks and marks expired orders that are still awaiting_payment."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with _BILLING_LOCK:
        for oid, ord_data in list(_MEM_ORDERS.items()):
            if ord_data.get("status") == "awaiting_payment":
                exp = ord_data.get("expires_at", "")
                if exp and exp < now_iso:
                    ord_data["status"] = "expired"
                    ord_data["updated_at"] = now_iso
                    _sync_order_to_supabase(ord_data)
                    log_payment_audit(oid, "system", "order_expired", {"reason": "timeout"})


def log_payment_audit(order_id: str, actor: str, action: str, detail: Any = None) -> None:
    audit_row = {
        "id": f"aud_{uuid.uuid4().hex[:12]}",
        "order_id": order_id,
        "actor": actor,
        "action": action,
        "detail": detail if isinstance(detail, dict) else {"info": str(detail)},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    _sync_audit_to_supabase(audit_row)


def create_quota_order(
    tenant_id: str,
    user_id: str,
    quantity: int,
    user_email: str = ""
) -> Tuple[bool, Dict[str, Any], Optional[str]]:
    """
    Creates a new quota order.
    Enforces quantity validation and single active order rule.
    Server calculates amount; never trusts client amount.
    """
    expire_stale_orders()

    max_cams = get_max_cameras_per_order()
    if quantity < 1 or quantity > max_cams:
        return False, {}, f"Quantity must be between 1 and {max_cams}."

    with _BILLING_LOCK:
        # Check active orders
        for ord_data in _MEM_ORDERS.values():
            if ord_data.get("tenant_id") == tenant_id and ord_data.get("status") in ("awaiting_payment", "submitted"):
                return False, ord_data, "You already have an active camera plan order in progress."

        order_id = f"ord_{uuid.uuid4().hex[:14]}"
        order_code = f"VYZ-{secrets.randbelow(9000) + 1000}"
        unit_price = get_camera_price_paise()
        amount_paise = quantity * unit_price

        now_dt = datetime.now(timezone.utc)
        expires_dt = now_dt + timedelta(minutes=get_order_expiry_minutes())

        order: Dict[str, Any] = {
            "id": order_id,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "user_email": user_email,
            "quantity": quantity,
            "unit_price_paise": unit_price,
            "amount_paise": amount_paise,
            "order_code": order_code,
            "status": "awaiting_payment",
            "utr": None,
            "submitted_at": None,
            "verified_by": None,
            "verified_at": None,
            "reject_reason": None,
            "expires_at": expires_dt.isoformat(),
            "created_at": now_dt.isoformat(),
            "updated_at": now_dt.isoformat()
        }

        # Build payment link and QR via pluggable provider
        provider = get_payment_provider()
        pay_info = provider.build_payment(order)
        order["upi_link"] = pay_info["upi_link"]
        order["qr"] = pay_info["qr"]

        _sync_order_to_supabase(order)
        log_payment_audit(order_id, user_id, "order_created", {
            "quantity": quantity,
            "amount_paise": amount_paise,
            "order_code": order_code
        })

        return True, order, None


def get_order(order_id: str) -> Optional[Dict[str, Any]]:
    expire_stale_orders()
    with _BILLING_LOCK:
        ord_data = _MEM_ORDERS.get(order_id)
        if ord_data:
            return dict(ord_data)

    sb = _get_supabase_headers()
    if sb:
        url, headers = sb
        try:
            r = requests.get(f"{url}/rest/v1/quota_orders?id=eq.{order_id}&select=*", headers=headers, timeout=3.5)
            if r.status_code == 200:
                rows = r.json()
                if rows:
                    ord_data = rows[0]
                    # Ensure payment info is attached
                    if ord_data.get("status") == "awaiting_payment" and not ord_data.get("qr"):
                        provider = get_payment_provider()
                        pay_info = provider.build_payment(ord_data)
                        ord_data["upi_link"] = pay_info["upi_link"]
                        ord_data["qr"] = pay_info["qr"]
                    _MEM_ORDERS[order_id] = ord_data
                    return ord_data
        except Exception as e:
            logger.warning(f"Error fetching order from Supabase: {e}")
    return None


def list_orders_for_tenant(tenant_id: str) -> List[Dict[str, Any]]:
    expire_stale_orders()
    orders: List[Dict[str, Any]] = []
    with _BILLING_LOCK:
        for ord_data in _MEM_ORDERS.values():
            if ord_data.get("tenant_id") == tenant_id:
                orders.append(dict(ord_data))

    orders.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return orders


def list_pending_orders_for_admin() -> List[Dict[str, Any]]:
    expire_stale_orders()
    orders: List[Dict[str, Any]] = []
    with _BILLING_LOCK:
        for ord_data in _MEM_ORDERS.values():
            if ord_data.get("status") in ("submitted", "awaiting_payment"):
                orders.append(dict(ord_data))

    orders.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return orders


def list_all_orders_for_admin() -> List[Dict[str, Any]]:
    expire_stale_orders()
    with _BILLING_LOCK:
        orders = [dict(o) for o in _MEM_ORDERS.values()]
    orders.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return orders


def submit_order_utr(
    order_id: str,
    utr: str,
    actor_id: str,
    actor_email: str = ""
) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]]]:
    """
    Submits 12-digit UTR for order verification.
    Validates regex, uniqueness, and sends Telegram alert to admin.
    """
    clean_utr = utr.strip()
    if not re.match(r"^\d{12}$", clean_utr):
        return False, "Invalid UPI Reference (UTR). It must be exactly 12 digits.", None

    with _BILLING_LOCK:
        order = get_order(order_id)
        if not order:
            return False, "Order not found.", None

        if order.get("status") == "submitted":
            return False, "UTR has already been submitted for this order. Verification is in progress.", None
        if order.get("status") == "paid":
            return False, "This order is already paid and completed.", None
        if order.get("status") == "expired":
            return False, "This order has expired. Please create a new order.", None
        if order.get("status") != "awaiting_payment":
            return False, f"Cannot submit UTR for order with status '{order.get('status')}'.", None

        # Check UTR uniqueness across active/completed orders
        for oid, existing in _MEM_ORDERS.items():
            if oid != order_id and existing.get("utr") == clean_utr and existing.get("status") in ("submitted", "paid"):
                return False, "This UPI Reference (UTR) has already been submitted for another order.", None

        now_iso = datetime.now(timezone.utc).isoformat()
        order["status"] = "submitted"
        order["utr"] = clean_utr
        order["submitted_at"] = now_iso
        order["updated_at"] = now_iso

        _sync_order_to_supabase(order)
        log_payment_audit(order_id, actor_id, "utr_submitted", {"utr": clean_utr})

    # Dispatch notification to Admin Telegram Bot
    send_admin_telegram_order_notification(order, actor_email or order.get("user_email", ""))

    return True, None, order


def approve_order(
    order_id: str,
    verified_by: str
) -> Tuple[bool, Optional[str], int]:
    """
    Approves order in ONE atomic transaction.
    Strictly idempotent: calling approve twice never double-credits quota.
    """
    with _BILLING_LOCK:
        order = get_order(order_id)
        if not order:
            return False, "Order not found.", 0

        tenant_id = order["tenant_id"]
        current_purchased = _MEM_QUOTA.get(tenant_id, 0)

        # Idempotency check: if already paid, return success without double-credit
        if order.get("status") == "paid":
            return True, None, current_purchased

        if order.get("status") not in ("submitted", "awaiting_payment"):
            return False, f"Cannot approve order with status '{order.get('status')}'.", current_purchased

        now_iso = datetime.now(timezone.utc).isoformat()
        order["status"] = "paid"
        order["verified_by"] = verified_by
        order["verified_at"] = now_iso
        order["updated_at"] = now_iso

        quantity = int(order.get("quantity", 1))
        new_purchased = current_purchased + quantity
        _sync_quota_to_supabase(tenant_id, new_purchased)
        _sync_order_to_supabase(order)

        log_payment_audit(order_id, verified_by, "order_approved", {
            "quantity": quantity,
            "new_purchased": new_purchased
        })

        logger.info(f"Order {order['order_code']} ({order_id}) approved by {verified_by}. +{quantity} quota (Total: {new_purchased})")
        return True, None, new_purchased


def reject_order(
    order_id: str,
    verified_by: str,
    reason: str = "UTR not verified on bank statement"
) -> Tuple[bool, Optional[str]]:
    """Rejects order with mandatory reason and logs audit row."""
    with _BILLING_LOCK:
        order = get_order(order_id)
        if not order:
            return False, "Order not found."

        if order.get("status") == "paid":
            return False, "Cannot reject an already approved/paid order."

        now_iso = datetime.now(timezone.utc).isoformat()
        order["status"] = "rejected"
        order["reject_reason"] = reason
        order["verified_by"] = verified_by
        order["verified_at"] = now_iso
        order["updated_at"] = now_iso

        _sync_order_to_supabase(order)
        log_payment_audit(order_id, verified_by, "order_rejected", {"reason": reason})

        logger.info(f"Order {order['order_code']} ({order_id}) rejected by {verified_by}: {reason}")
        return True, None


# -----------------------------------------------------------------------------
# Telegram Admin Bot Notifications
# -----------------------------------------------------------------------------

def send_admin_telegram_order_notification(order: Dict[str, Any], user_email: str = "") -> bool:
    """
    Sends interactive Telegram alert to Admin Bot (@Vyzn_admin_bot)
    with inline [Approve] and [Reject] callback buttons.
    """
    bot_token = os.environ.get("ADMIN_TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("ADMIN_TELEGRAM_CHAT_ID")
    if not bot_token or not chat_id:
        logger.warning("Admin Telegram notification skipped: missing ADMIN_TELEGRAM_BOT_TOKEN or ADMIN_TELEGRAM_CHAT_ID")
        return False

    order_id = order.get("id")
    order_code = order.get("order_code")
    quantity = order.get("quantity")
    amount_rupees = f"{order.get('amount_paise', 0) / 100:.2f}"
    utr = order.get("utr") or "Pending"
    tenant_id = order.get("tenant_id")
    email_display = user_email or order.get("user_email") or "Customer"

    text = (
        f"🔔 *New Camera Plan Payment Submitted*\n\n"
        f"• *Order Code:* `{order_code}`\n"
        f"• *Cameras Requested:* *+{quantity} Cameras*\n"
        f"• *Amount:* *₹{amount_rupees}*\n"
        f"• *UPI Ref (UTR):* `{utr}`\n"
        f"• *Customer:* `{email_display}`\n"
        f"• *Tenant ID:* `{tenant_id}`\n\n"
        f"⚠️ _Payments are verified manually._ Verify this UTR on your bank app statement, then approve or reject below:\n"
        f"👉 [Open Admin Web Console](https://vyzn-security.vercel.app/admin/billing)"
    )

    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "✅ Approve (+Quota)", "callback_data": f"approve:{order_id}"},
                {"text": "❌ Reject", "callback_data": f"reject:{order_id}"}
            ]
        ]
    }

    try:
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "reply_markup": reply_markup
        }
        res = requests.post(url, json=payload, timeout=8.0)
        return res.status_code == 200 and res.json().get("ok", False)
    except Exception as e:
        logger.error(f"Failed to send Telegram admin notification: {e}")
        return False


def handle_admin_telegram_callback(callback_query: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handles inline button callback from @Vyzn_admin_bot.
    Data format: approve:<order_id> or reject:<order_id>
    """
    bot_token = os.environ.get("ADMIN_TELEGRAM_BOT_TOKEN")
    admin_chat_id = os.environ.get("ADMIN_TELEGRAM_CHAT_ID", "6856103038")

    from_user = callback_query.get("from", {})
    user_id = str(from_user.get("id"))
    data = callback_query.get("data", "")
    cq_id = callback_query.get("id")
    message = callback_query.get("message", {})
    chat = message.get("chat", {})
    chat_id = chat.get("id")
    message_id = message.get("message_id")

    # Authorize sender
    if user_id != admin_chat_id and str(chat_id) != admin_chat_id:
        return {"ok": False, "error": "Unauthorized telegram user"}

    action_text = ""
    if data.startswith("approve:"):
        order_id = data.split("approve:", 1)[1]
        ok, err, new_q = approve_order(order_id, verified_by=f"telegram_admin_{user_id}")
        if ok:
            action_text = f"✅ Order approved! +quota added (Total: {new_q})."
        else:
            action_text = f"Approval failed: {err}"
    elif data.startswith("reject:"):
        order_id = data.split("reject:", 1)[1]
        ok, err = reject_order(order_id, verified_by=f"telegram_admin_{user_id}", reason="UTR rejected via Telegram Admin")
        if ok:
            action_text = "❌ Order rejected."
        else:
            action_text = f"Rejection failed: {err}"
    else:
        action_text = "Unknown action."

    # Answer callback query so button stops spinning
    if bot_token and cq_id:
        try:
            requests.post(
                f"https://api.telegram.org/bot{bot_token}/answerCallbackQuery",
                json={"callback_query_id": cq_id, "text": action_text},
                timeout=5.0
            )
        except Exception:
            pass

    # Edit message to reflect final decision
    if bot_token and chat_id and message_id:
        try:
            orig_text = message.get("text", "")
            updated_text = orig_text + f"\n\n━━━━━━━━━━━━━━━━━━━━\n*{action_text}*"
            requests.post(
                f"https://api.telegram.org/bot{bot_token}/editMessageText",
                json={
                    "chat_id": chat_id,
                    "message_id": message_id,
                    "text": updated_text,
                    "parse_mode": "Markdown"
                },
                timeout=5.0
            )
        except Exception:
            pass

    return {"ok": True, "action": action_text}
