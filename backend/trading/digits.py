"""
Last-digit extraction, ported from the TypeScript frontend.

Both stacks MUST agree, because a digit contract settles on this single value: if the browser and
the worker disagree about what the last digit of 571.94 is, they will disagree about who won.

The frontend uses `quote.toFixed(pipSize)` and takes the final character. `toFixed` rounds
half-away-from-zero on the value's decimal expansion, which is NOT what Python's built-in
`round()` does (that is banker's rounding) and NOT what `f"{x:.2f}"` guarantees either. So this
port goes through `decimal.Decimal` with an explicit ROUND_HALF_UP, and the accompanying tests
check it against an independent scaled-integer method over tens of thousands of values.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

PIP_RANGE = range(0, 11)


class DigitExtractionError(ValueError):
    """Raised when a quote or pip_size cannot produce a last digit."""


def last_digit(quote: float, pip_size: int) -> int:
    """
    Return the final digit of `quote` rendered with `pip_size` decimal places.

    Trailing zeros are significant: last_digit(571.9, 2) == 0, not 9. That matches Deriv, which
    treats the digit at the instrument's pip position as the settling digit.
    """
    if isinstance(quote, bool) or not isinstance(quote, (int, float)):
        raise DigitExtractionError(f"quote must be a number, got {type(quote).__name__}")
    q = float(quote)
    if q != q or q in (float("inf"), float("-inf")):  # NaN / +-inf
        raise DigitExtractionError(f"quote is not finite: {quote!r}")
    if not isinstance(pip_size, int) or isinstance(pip_size, bool):
        raise DigitExtractionError(f"pip_size must be an int, got {type(pip_size).__name__}")
    if pip_size not in PIP_RANGE:
        raise DigitExtractionError(f"pip_size must be an integer 0..10, got {pip_size}")

    quantum = Decimal(1).scaleb(-pip_size)
    # Decimal(float) is the EXACT binary value, matching what JS toFixed operates on.
    rendered = Decimal(q).quantize(quantum, rounding=ROUND_HALF_UP)
    text = format(rendered, "f")
    if pip_size == 0:
        # No fractional part; the digit is the final character of the integer portion.
        digits_only = text.lstrip("-")
    else:
        digits_only = text.replace("-", "").replace(".", "")
    if not digits_only:
        raise DigitExtractionError(f"could not derive a digit from {text}")
    d = int(digits_only[-1])
    if d < 0 or d > 9:
        raise DigitExtractionError(f"could not derive a digit from {text}")
    return d


def last_digit_by_scaling(quote: float, pip_size: int) -> int:
    """
    Independent second method, used by the test suite to cross-check `last_digit`.

    Deliberately written a different way (integer scaling) so agreement between the two is real
    evidence rather than a tautology. Uses floor(x + 0.5) to reproduce JavaScript's Math.round
    half-up behaviour instead of Python's banker's rounding.
    """
    import math

    scaled = math.floor(float(quote) * (10**pip_size) + 0.5) if quote >= 0 else math.ceil(float(quote) * (10**pip_size) - 0.5)
    return abs(scaled) % 10


DIGIT_CONTRACTS = frozenset(
    {"DIGITODD", "DIGITEVEN", "DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"}
)


def settle_digit_contract(contract_type: str, barrier: int | None, exit_digit: int) -> bool:
    """
    Settle a digit contract from the exit digit alone.

    Over/under use STRICT inequality, exactly as Deriv does: with a barrier of 5, an exit digit of
    5 loses on both DIGITOVER and DIGITUNDER. Getting this wrong makes a backtest systematically
    optimistic.
    """
    if contract_type not in DIGIT_CONTRACTS:
        raise DigitExtractionError(f"{contract_type} cannot be settled from digits alone")
    b = 5 if barrier is None else int(barrier)
    if contract_type == "DIGITODD":
        return exit_digit % 2 == 1
    if contract_type == "DIGITEVEN":
        return exit_digit % 2 == 0
    if contract_type == "DIGITOVER":
        return exit_digit > b
    if contract_type == "DIGITUNDER":
        return exit_digit < b
    if contract_type == "DIGITMATCH":
        return exit_digit == b
    if contract_type == "DIGITDIFF":
        return exit_digit != b
    raise DigitExtractionError(f"unhandled contract type {contract_type}")


def theoretical_win_probability(contract_type: str, barrier: int | None = 5) -> float:
    """Win probability under a fair uniform draw — the honest benchmark, never a prediction."""
    b = 5 if barrier is None else int(barrier)
    return {
        "DIGITODD": 0.5,
        "DIGITEVEN": 0.5,
        "DIGITOVER": max(0, 9 - b) / 10,
        "DIGITUNDER": max(0, b) / 10,
        "DIGITMATCH": 0.1,
        "DIGITDIFF": 0.9,
    }[contract_type]


def round2(value: float) -> float:
    """Round to 2dp for money, half-up, matching the frontend's round2."""
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
