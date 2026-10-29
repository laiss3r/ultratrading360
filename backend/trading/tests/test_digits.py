"""Digit extraction and settlement — must agree with the TypeScript frontend exactly."""

import random

import pytest

from trading.digits import (
    DigitExtractionError, last_digit, last_digit_by_scaling, round2,
    settle_digit_contract, theoretical_win_probability,
)


class TestLastDigit:
    @pytest.mark.parametrize(
        "quote,pip,expected",
        [
            (571.94, 2, 4),      # the notorious float case: 571.94*100 == 57194.00000000001
            (571.9, 2, 0),       # trailing zero is significant
            (1234.567, 3, 7),
            (100.0, 0, 0),
            (571.0, 0, 1),
            (0.05, 2, 5),
            (0.0, 2, 0),
            (9.999, 2, 0),       # 10.00 -> 0
        ],
    )
    def test_known_values(self, quote, pip, expected):
        assert last_digit(quote, pip) == expected

    def test_negative_quotes_use_magnitude(self):
        assert last_digit(-571.94, 2) == 4
        assert last_digit(-1.23, 2) == 3

    def test_rejects_non_finite(self):
        for bad in (float("nan"), float("inf"), float("-inf")):
            with pytest.raises(DigitExtractionError):
                last_digit(bad, 2)

    def test_rejects_bad_pip_size(self):
        for bad in (-1, 11, 2.5, "2", True):
            with pytest.raises(DigitExtractionError):
                last_digit(1.23, bad)

    def test_rejects_non_numeric_quote(self):
        with pytest.raises(DigitExtractionError):
            last_digit("571.94", 2)  # type: ignore[arg-type]

    def test_always_returns_0_to_9(self):
        rng = random.Random(1234)
        for _ in range(5000):
            d = last_digit(rng.uniform(0, 5000), rng.randint(0, 4))
            assert 0 <= d <= 9

    def test_agrees_with_independent_scaled_method(self):
        """
        The two implementations are written differently on purpose, so agreement over a large
        sample is real evidence rather than a tautology.
        """
        rng = random.Random(7)
        mismatches = 0
        for _ in range(50_000):
            q = rng.uniform(0, 2000)
            p = rng.randint(0, 4)
            if last_digit(q, p) != last_digit_by_scaling(q, p):
                mismatches += 1
        assert mismatches == 0, f"{mismatches} mismatches between extraction methods"


class TestSettlement:
    def test_over_and_under_use_strict_inequality(self):
        # The barrier digit itself loses BOTH ways — getting this wrong inflates every backtest.
        assert settle_digit_contract("DIGITOVER", 5, 5) is False
        assert settle_digit_contract("DIGITUNDER", 5, 5) is False
        assert settle_digit_contract("DIGITOVER", 5, 6) is True
        assert settle_digit_contract("DIGITUNDER", 5, 4) is True

    def test_parity(self):
        for d in range(10):
            assert settle_digit_contract("DIGITODD", None, d) is (d % 2 == 1)
            assert settle_digit_contract("DIGITEVEN", None, d) is (d % 2 == 0)

    def test_match_and_differ_are_exact_complements(self):
        for d in range(10):
            m = settle_digit_contract("DIGITMATCH", 7, d)
            diff = settle_digit_contract("DIGITDIFF", 7, d)
            assert m != diff
            assert m is (d == 7)

    def test_barrier_defaults_to_5(self):
        assert settle_digit_contract("DIGITMATCH", None, 5) is True
        assert settle_digit_contract("DIGITMATCH", None, 4) is False

    def test_rejects_contracts_that_need_prices(self):
        with pytest.raises(DigitExtractionError):
            settle_digit_contract("CALL", 5, 3)
        with pytest.raises(DigitExtractionError):
            settle_digit_contract("NONSENSE", 5, 3)

    def test_exhaustive_win_counts_over_a_uniform_cycle(self):
        digits = list(range(10)) * 100
        assert sum(settle_digit_contract("DIGITDIFF", 5, d) for d in digits) == 900
        assert sum(settle_digit_contract("DIGITMATCH", 5, d) for d in digits) == 100
        assert sum(settle_digit_contract("DIGITODD", None, d) for d in digits) == 500


class TestTheoreticalProbability:
    @pytest.mark.parametrize(
        "ct,barrier,expected",
        [
            ("DIGITODD", None, 0.5),
            ("DIGITEVEN", None, 0.5),
            ("DIGITMATCH", 5, 0.1),
            ("DIGITDIFF", 5, 0.9),
            ("DIGITOVER", 5, 0.4),   # 6,7,8,9
            ("DIGITUNDER", 5, 0.5),  # 0,1,2,3,4
            ("DIGITOVER", 0, 0.9),
            ("DIGITUNDER", 9, 0.9),
            ("DIGITOVER", 9, 0.0),
            ("DIGITUNDER", 0, 0.0),
        ],
    )
    def test_values(self, ct, barrier, expected):
        assert theoretical_win_probability(ct, barrier) == pytest.approx(expected)

    def test_probabilities_match_simulated_settlement(self):
        """Theoretical probability must equal the empirical rate over a full uniform cycle."""
        digits = list(range(10)) * 1000
        for ct, barrier in [("DIGITODD", None), ("DIGITMATCH", 3), ("DIGITOVER", 5), ("DIGITDIFF", 7)]:
            empirical = sum(settle_digit_contract(ct, barrier, d) for d in digits) / len(digits)
            assert empirical == pytest.approx(theoretical_win_probability(ct, barrier), abs=1e-9)


class TestRound2:
    def test_half_up_not_bankers_rounding(self):
        # Python's round() would give 0.12 here (banker's rounding); money rounds half-up.
        assert round2(0.125) == 0.13
        assert round2(-0.125) == -0.13

    def test_idempotent(self):
        for v in (1.0, -2.5, 0.005, 12345.678):
            assert round2(round2(v)) == round2(v)
