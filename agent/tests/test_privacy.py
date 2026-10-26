"""The agent must never be able to show more than the public map does."""
import json

from vauban_agent import tools

# fields that exist in private.feedback and must never come out of a tool
PRIVATE_FIELDS = {"session_id", "age_group", "occurred_at", "created_at", "time_of_day", "travel_mode",
                  "accuracy_m", "consent_version", "avoids_place", "answers", "is_demo", "status", "comment_status"}


def _keys(obj, found=None):
    found = set() if found is None else found
    if isinstance(obj, dict):
        for k, v in obj.items():
            found.add(k)
            _keys(v, found)
    elif isinstance(obj, list):
        for v in obj:
            _keys(v, found)
    return found


def test_no_tool_output_has_private_fields(ctx):
    outputs = [
        tools.get_hotspots(ctx, topic="safety", limit=20),
        tools.get_hotspots(ctx, topic="crowd", limit=20),
        tools.hotspots_with_nearby(ctx, layer="lamps", limit=20),
        tools.search_knowledge(ctx, "anything", source="any", k=8),
    ]
    for out in outputs:
        assert not (_keys(out) & PRIVATE_FIELDS), json.dumps(out)[:300]


def test_the_data_layer_has_no_way_to_read_private_reports():
    # the only network call in the agent is the public get_hotspots RPC
    import inspect
    from vauban_agent import data
    src = inspect.getsource(data)
    assert "private.feedback" not in src.replace("private reports table", "")
    assert "/rest/v1/rpc/get_hotspots" in src
    assert "service_role" not in src


def test_hotspots_say_what_is_not_available(ctx):
    note = tools.get_hotspots(ctx, topic="safety")["privacy"]
    assert "at least 3 different people" in note and "time of day" in note


def test_every_public_square_has_at_least_3_reports(ctx):
    for topic in ("safety", "crowd"):
        assert all(s["reports"] >= 3 for s in tools.get_hotspots(ctx, topic=topic, limit=20)["squares"])
