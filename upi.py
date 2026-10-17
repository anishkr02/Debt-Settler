"""
Generates UPI deep-links from settlement transactions.

Standard UPI intent URI format:
    upi://pay?pa={payee_vpa}&pn={payee_name}&am={amount}&cu=INR&tn={note}

No payment gateway integration is needed — any UPI-enabled app on Android
intercepts this URI natively.
"""

from urllib.parse import quote

from models import Member


def build_upi_link(
    payee: Member,
    amount: float,
    note: str = "Debt-Settle payment",
) -> str:
    if not payee.upi_id:
        return "upi://pay"

    params = {
        "pa": payee.upi_id,
        "pn": payee.name,
        "am": f"{amount:.2f}",
        "cu": "INR",
        "tn": note,
    }
    query = "&".join(f"{k}={quote(str(v))}" for k, v in params.items())
    return f"upi://pay?{query}"
