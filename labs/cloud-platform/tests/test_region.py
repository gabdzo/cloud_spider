from pathlib import Path

import pytest

from labctl.config import DEFAULT_REGION, SettingsError, load_settings
from labctl.scenario import load_scenario

SCENARIOS = Path(__file__).resolve().parents[1] / "scenarios"


def test_default_region_is_cloud_spiders():
    settings = load_settings({})
    assert DEFAULT_REGION == "eu-north-1"
    assert settings.home_region == "eu-north-1"
    assert settings.region_override is None
    for scenario_id in ("aws-smoke-001", "aws-web-unreachable-001"):
        assert load_scenario(SCENARIOS, scenario_id).region == "eu-north-1"


def test_lab_region_moves_scenarios_and_the_janitor():
    settings = load_settings({"LAB_REGION": "eu-central-1"})
    assert settings.home_region == "eu-central-1"
    assert settings.region_override == "eu-central-1"
    scenario = load_scenario(SCENARIOS, "aws-smoke-001", region=settings.region_override)
    assert scenario.region == "eu-central-1"


def test_lab_region_must_look_like_a_region():
    for bad in ("Frankfurt", "eu-north", "eu-north-1; rm -rf /"):
        with pytest.raises(SettingsError):
            load_settings({"LAB_REGION": bad})
    assert load_settings({"LAB_REGION": "  "}).home_region == "eu-north-1"
    assert load_settings({"LAB_REGION": "us-gov-west-1"}).home_region == "us-gov-west-1"


def test_lifecycle_passes_the_override_to_the_scenario(tmp_path, monkeypatch):
    from labctl import lifecycle

    seen = {}

    def fake_load(scenarios_dir, scenario_id, region=None):
        seen["region"] = region
        raise RuntimeError("stop here")

    monkeypatch.setattr(lifecycle, "load_scenario", fake_load)
    settings = load_settings({"LAB_REGION": "eu-west-1", "LAB_REPO_ROOT": str(tmp_path)})

    class Deps:
        pass

    deps = Deps()
    deps.settings = settings
    lab = lifecycle.Lab.__new__(lifecycle.Lab)
    lab.d = deps
    with pytest.raises(RuntimeError):
        lab._scenario("aws-smoke-001")
    assert seen["region"] == "eu-west-1"
