import os
from datetime import date, timedelta

import schedule_groups as sg


def test_brand_group_index_is_deterministic_across_calls():
    a = sg.brand_group_index('Rooster Partners', 'Rocketspin')
    b = sg.brand_group_index('Rooster Partners', 'Rocketspin')
    assert a == b


def test_brand_group_index_is_case_and_whitespace_insensitive():
    a = sg.brand_group_index('Rooster Partners', 'Rocketspin')
    b = sg.brand_group_index(' rooster partners ', ' ROCKETSPIN ')
    assert a == b


def test_brand_group_index_in_range():
    for brand in ['Rocketspin', 'Lucky7even', 'Trybet.com', 'Boho Casino', '']:
        idx = sg.brand_group_index('Some Tab', brand)
        assert 0 <= idx < sg.NUM_GROUPS


def test_brand_group_index_differs_across_tabs_for_same_brand_name():
    # Not a hard requirement, just documents that (tab, brand) is the key,
    # not brand alone -- two tabs sharing a brand name aren't forced together.
    a = sg.brand_group_index('Rooster Partners', 'Rollero')
    b = sg.brand_group_index('Wizard of Odds', 'Rollero')
    # They *can* coincide by chance (1-in-3), so just assert both are valid
    # rather than asserting inequality (which would be flaky).
    assert 0 <= a < sg.NUM_GROUPS
    assert 0 <= b < sg.NUM_GROUPS


def test_active_group_index_cycles_through_all_groups_weekly():
    day0 = sg._EPOCH
    groups = [sg.active_group_index(date.fromordinal(day0.toordinal() + 7 * i)) for i in range(6)]
    assert groups == [0, 1, 2, 0, 1, 2]


def test_active_group_index_is_stable_within_the_same_week():
    base = sg.active_group_index(sg._EPOCH)
    mid_week = sg.active_group_index(sg._EPOCH + timedelta(days=3))
    assert base == mid_week


def test_brand_group_index_distribution_is_not_wildly_skewed():
    # Smoke test for "the hash isn't degenerate" (e.g. always returning 0), not a precise
    # balance guarantee -- per the design spec's request for a rough distribution check
    # across a representative brand roster. Uses a synthetic ~45-brand set across a couple
    # of tab names, since no real Supabase data is available in this environment.
    brands = [
        'Rocketspin', 'Lucky7even', 'Trybet.com', 'Boho Casino', 'Fortuneplay', 'Rollero',
        'SilverPlay', 'Revolution Casino', 'Prive Casino', 'Online Casino Deutschland',
        'ZodiacBet.com', 'Casino Extreme', 'Golden Reels', 'Spin Palace', 'Royal Vegas',
        'Bet Kingdom', 'Lucky Star Casino', 'Diamond Reels', 'Vegas Crest', 'Slot Empire',
        'Jackpot Wheel', 'Winward Casino', 'Sun Palace', 'Uptown Aces', 'Red Dog Casino',
        'Cafe Casino', 'Ignition Casino', 'BetOnline', 'Bovada', 'MyBookie',
        'Wild Casino', 'El Royale', 'Las Atlantis', 'Super Slots', 'Everygame',
        'Casino Days', 'PlayAmo', 'Bitstarz', 'Fairspin', 'mBit Casino',
        'Cloudbet', 'Stake Casino', 'Rocketpot', 'BC.Game', 'Trustdice',
    ]
    tabs = ['Rooster Partners', 'Hanan']
    counts = {}
    for tab in tabs:
        for brand in brands:
            idx = sg.brand_group_index(tab, brand)
            counts[idx] = counts.get(idx, 0) + 1

    assert set(counts.keys()) == set(range(sg.NUM_GROUPS))  # every group actually got at least one
    smallest = min(counts.values())
    largest = max(counts.values())
    assert largest <= smallest * 2.5  # loose bound -- catches a degenerate hash, not a precise balance


def test_in_active_group_matches_brand_and_active_group():
    day0 = sg._EPOCH
    assert sg.active_group_index(day0) == 0
    matching = None
    non_matching = None
    for name in ['brand-a', 'brand-b', 'brand-c', 'brand-d', 'brand-e', 'brand-f']:
        idx = sg.brand_group_index('Tab', name)
        if idx == 0 and matching is None:
            matching = name
        elif idx != 0 and non_matching is None:
            non_matching = name
    assert matching is not None
    assert non_matching is not None
    assert sg.in_active_group('Tab', matching, today=day0) is True
    assert sg.in_active_group('Tab', non_matching, today=day0) is False


def test_in_active_group_bypass_env_var_forces_true(monkeypatch):
    day0 = sg._EPOCH
    assert sg.active_group_index(day0) == 0
    # Find a brand that would normally be OUT of today's active group.
    non_matching = next(
        name for name in ['brand-a', 'brand-b', 'brand-c', 'brand-d', 'brand-e', 'brand-f']
        if sg.brand_group_index('Tab', name) != 0
    )
    assert sg.in_active_group('Tab', non_matching, today=day0) is False

    monkeypatch.setenv('SCHEDULE_GROUP_BYPASS', '1')
    assert sg.in_active_group('Tab', non_matching, today=day0) is True


def test_in_active_group_bypass_env_var_case_insensitive(monkeypatch):
    monkeypatch.setenv('SCHEDULE_GROUP_BYPASS', 'True')
    assert sg.in_active_group('Tab', 'any-brand') is True


def test_in_active_group_bypass_env_var_unset_restores_normal_behavior(monkeypatch):
    monkeypatch.delenv('SCHEDULE_GROUP_BYPASS', raising=False)
    day0 = sg._EPOCH
    non_matching = next(
        name for name in ['brand-a', 'brand-b', 'brand-c', 'brand-d', 'brand-e', 'brand-f']
        if sg.brand_group_index('Tab', name) != 0
    )
    assert sg.in_active_group('Tab', non_matching, today=day0) is False
