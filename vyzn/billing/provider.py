"""
VYZN Payment Provider Interface & Implementations.
Enables pluggable payment providers. Manual UPI QR with human verification
is the primary provider; a payment gateway can replace it later by implementing
PaymentProvider and changing one file.
"""

from __future__ import annotations
import os
import io
import base64
import urllib.parse
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import qrcode
from qrcode.constants import ERROR_CORRECT_M


class PaymentProvider(ABC):
    """Abstract payment provider interface for camera quota purchases."""

    @abstractmethod
    def build_payment(self, order: Dict[str, Any]) -> Dict[str, Any]:
        """
        Builds payment details and instructions for the customer.
        Returns a dictionary containing at least:
        - upi_link: URI for direct UPI app invocation (e.g., upi://pay?...)
        - qr: Base64 data URL of the payment QR code image (data:image/png;base64,...)
        """
        pass


class ManualUpiProvider(PaymentProvider):
    """
    Personal UPI QR payment provider with manual UTR verification.
    Uses payee VPA and Payee Name from environment variables.
    Generates dynamic fixed-amount QR codes matching UPI specifications.
    """

    def __init__(
        self,
        vpa: Optional[str] = None,
        payee_name: Optional[str] = None
    ):
        self.vpa = (vpa or os.environ.get("UPI_VPA") or "vyzn.security@okaxis").strip()
        self.payee_name = (payee_name or os.environ.get("UPI_PAYEE_NAME") or "VYZN Security").strip()

    def build_payment(self, order: Dict[str, Any]) -> Dict[str, Any]:
        """
        Constructs the fixed-amount UPI payment link and generates QR code.
        Amount is in paise; converted to rupees with exactly 2 decimal places.
        """
        amount_paise = int(order.get("amount_paise") or 0)
        rupees_str = f"{amount_paise / 100:.2f}"
        order_code = str(order.get("order_code") or "").strip()

        # Build URL-encoded query parameters
        params = {
            "pa": self.vpa,
            "pn": self.payee_name,
            "am": rupees_str,
            "tn": order_code,
            "cu": "INR"
        }
        # Format: upi://pay?pa=...&pn=...&am=...&tn=...&cu=INR
        query_string = urllib.parse.urlencode(params)
        upi_link = f"upi://pay?{query_string}"

        # Render QR code image
        qr_data_url = self._render_qr_base64(upi_link)

        return {
            "upi_link": upi_link,
            "qr": qr_data_url,
            "vpa": self.vpa,
            "payee_name": self.payee_name,
            "amount_rupees": rupees_str,
            "order_code": order_code
        }

    def _render_qr_base64(self, content: str) -> str:
        """Renders string content into a high-contrast base64 PNG data URL."""
        qr = qrcode.QRCode(
            version=1,
            error_correction=ERROR_CORRECT_M,
            box_size=8,
            border=2
        )
        qr.add_data(content)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{b64}"


_ACTIVE_PROVIDER: Optional[PaymentProvider] = None


def get_payment_provider() -> PaymentProvider:
    """Returns active PaymentProvider singleton."""
    global _ACTIVE_PROVIDER
    if _ACTIVE_PROVIDER is None:
        _ACTIVE_PROVIDER = ManualUpiProvider()
    return _ACTIVE_PROVIDER


def set_payment_provider(provider: PaymentProvider) -> None:
    """Allows hot-swapping or testing mock payment providers."""
    global _ACTIVE_PROVIDER
    _ACTIVE_PROVIDER = provider
