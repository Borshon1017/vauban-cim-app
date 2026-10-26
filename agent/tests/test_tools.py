import json

from vauban_agent import tools
from vauban_agent.geo import dist_m, inside


def test_distance_is_metric():
    # 0.001 degree of latitude is about 111 m
    assert abs(dist_m(3.04, 50.63, 3.04, 50.631) - 111.3) < 0.5


def test_boundary_matches_app(ctx):
    assert inside(3.0445, 50.633, ctx.ring)        # JUNIA area
    assert not inside(3.06, 50.63, ctx.ring)       # east of the district


def test_counts_match_the_map_files(ctx):
    assert tools.count_features(ctx, "lamps")["count_in_district"] == 195
    crossings = tools.count_features(ctx, "crossings")
    assert crossings["count_in_district"] == 276
    assert crossings["by_kind"]["with traffic lights"] == 108
    assert sum(crossings["by_kind"].values()) == 276


def test_hotspots_sorted_worst_first_and_filtered(ctx):
    out = tools.get_hotspots(ctx, topic="safety", limit=20)
    scores = [s["avg_score"] for s in out["squares"]]
    assert scores == sorted(scores)
    assert out["squares_on_public_map"] == 19
    only = tools.get_hotspots(ctx, topic="safety", category="crossing", limit=20)
    assert only["matching"] > 0
    assert all(s["main_issue"] == "Crossing" for s in only["squares"])


def test_hotspot_squares_have_landmarks(ctx):
    sq = tools.get_hotspots(ctx, topic="safety", limit=20)["squares"]
    assert any(s["near"] for s in sq)


def test_nearby_is_sorted_and_capped(ctx):
    out = tools.nearby_features(ctx, lat=50.632, lon=3.0490, layer="lamps", radius_m=10_000, limit=50)
    assert out["radius_m"] == 500            # radius capped
    assert len(out["features"]) <= 25        # limit capped
    d = [f["distance_m"] for f in out["features"]]
    assert d == sorted(d)


def test_nearby_reports_nearest_when_none_within(ctx):
    out = tools.nearby_features(ctx, lat=50.632, lon=3.0490, layer="parking", radius_m=5)
    assert out["count_within_radius"] == 0
    assert "nearest_outside_radius" in out


def test_hotspots_with_nearby_only_without(ctx):
    out = tools.hotspots_with_nearby(ctx, layer="lamps", radius_m=5, only_without=True, limit=20)
    assert all(row["lamps_within_5m"] == 0 for row in out["squares"])


def test_find_place_local_bus_stop(ctx):
    out = tools.find_place(ctx, "daubenton")
    assert out["results"] and "DAUBENTON" in out["results"][0]["name"]
    assert out["results"][0]["source"] == "bus stops"


def test_search_knowledge_finds_privacy_text(ctx):
    out = tools.search_knowledge(ctx, "who can see my reports and exact place", source="docs")
    assert any(r["id"].startswith("doc:info.p3") for r in out["results"])


def test_search_comments_are_marked_untrusted(ctx):
    out = tools.search_knowledge(ctx, "cars do not stop for pedestrians", source="comments")
    assert out["results"] and all("instructions" in r["note"] for r in out["results"])


def test_show_on_map_only_accepts_ids_seen_this_turn(ctx):
    ctx.reset_turn()
    sid = tools.get_hotspots(ctx, topic="safety", limit=1)["squares"][0]["id"]
    out = tools.show_on_map(ctx, [sid, "lamp99999", "made-up"])
    assert out["shown"] == [sid]
    assert set(out["ignored"]["ids"]) == {"lamp99999", "made-up"}


def test_bad_arguments_return_an_error_not_a_crash(ctx):
    assert "error" in tools.call(ctx, "nearby_features", {"lat": 1})
    assert "error" in tools.call(ctx, "drop_tables", {})
    assert "error" in tools.call(ctx, "count_features", {"layer": "../../etc"})


def test_tool_schemas_are_valid_json():
    names = [t["function"]["name"] for t in tools.TOOL_SCHEMAS]
    assert len(names) == len(set(names)) == 7
    json.dumps(tools.TOOL_SCHEMAS)


def test_incomplete_bus_layer_says_so(ctx):
    near = tools.nearby_features(ctx, lat=50.6326, lon=3.0425, layer="bus", radius_m=100)
    assert near["count_within_radius"] == 0 and "Incomplete" in near["data_note"]
    assert "Incomplete" in tools.count_features(ctx, "bus")["data_note"]
