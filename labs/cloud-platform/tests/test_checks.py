from labctl.checks import Check, all_passed, format_table, outcome_failed_guards_passed, to_dicts

UP = Check("health", "outcome", True, "200")
DOWN = Check("health", "outcome", False, "timeout")
GUARD_OK = Check("no-world-ssh", "guard", True)
GUARD_BAD = Check("no-world-ssh", "guard", False, "sg-1")


def test_all_passed_requires_every_check_and_at_least_one():
    assert all_passed([UP, GUARD_OK])
    assert not all_passed([UP, GUARD_BAD])
    assert not all_passed([])


def test_fault_gate_needs_a_failed_outcome_and_clean_guards():
    assert outcome_failed_guards_passed([DOWN, GUARD_OK])
    assert not outcome_failed_guards_passed([UP, GUARD_OK])
    assert not outcome_failed_guards_passed([DOWN, GUARD_BAD])
    assert not outcome_failed_guards_passed([GUARD_OK])


def test_format_table_aligns_names():
    assert format_table([UP, GUARD_BAD]).splitlines() == [
        "PASS  outcome  health        200",
        "FAIL  guard    no-world-ssh  sg-1",
    ]


def test_to_dicts():
    assert to_dicts([UP]) == [{"name": "health", "kind": "outcome", "passed": True, "detail": "200"}]
