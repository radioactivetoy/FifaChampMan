import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bracketSize, bracketStages, slotsIn, firstRound, teamsIn, qualifiersFor, byeCount, nextStage, pickByeTeams } from '../../src/domain/bracket.js';

test('bracketSize rounds up to a power of two and rejects impossible sizes', () => {
  assert.deepEqual([2, 3, 4, 5, 8, 9, 12, 16, 17, 32, 33, 64].map(bracketSize), [2, 4, 4, 8, 8, 16, 16, 16, 32, 32, 64, 64]);
  assert.throws(() => bracketSize(1));
  assert.throws(() => bracketSize(65));
});

test('rounds are counted back from the final', () => {
  assert.deepEqual(bracketStages(2), ['final']);
  assert.deepEqual(bracketStages(4), ['sf', 'final']);
  assert.deepEqual(bracketStages(8), ['qf', 'sf', 'final']);
  assert.deepEqual(bracketStages(16), ['r16', 'qf', 'sf', 'final']);
  assert.deepEqual(bracketStages(64), ['r64', 'r32', 'r16', 'qf', 'sf', 'final']);
  assert.throws(() => bracketStages(12));
  assert.equal(firstRound(32), 'r32');
});

test('ties per round and teams that can reach it', () => {
  assert.deepEqual(['r16', 'qf', 'sf', 'final'].map(s => slotsIn(s, 16)), [8, 4, 2, 1]); // the current fixed bracket
  assert.deepEqual(['qf', 'sf', 'final'].map(s => slotsIn(s, 8)), [4, 2, 1]);
  assert.equal(slotsIn('r16', 8), 0); // not part of that bracket
  assert.equal(teamsIn('sf', 16), 4);
  assert.equal(slotsIn('r64', 64), 32);
});

test('qualifiers, byes and the next round', () => {
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8].map(qualifiersFor), [4, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual([4, 6, 8, 10, 12, 14, 16].map(byeCount), [0, 2, 0, 6, 4, 2, 0]); // 3 groups → 6 qualifiers → 2 byes
  assert.deepEqual([nextStage('r16', 16), nextStage('final', 16), nextStage('qf', 8), nextStage('r16', 8)], ['qf', 'champion', 'sf', null]);
});

test('the best group winners get the byes (points, goal difference, goals for, OVR, then id)', () => {
  const rows = [
    { teamId: 1, position: 1, points: 9, goalDiff: 5, goalsFor: 7, ovr: 80 },
    { teamId: 2, position: 2, points: 9, goalDiff: 9, goalsFor: 9, ovr: 90 }, // not a winner
    { teamId: 3, position: 1, points: 9, goalDiff: 6, goalsFor: 8, ovr: 70 },
    { teamId: 4, position: 1, points: 7, goalDiff: 9, goalsFor: 9, ovr: 95 },
    { teamId: 5, position: 1, points: 9, goalDiff: 6, goalsFor: 8, ovr: 75 },
  ];
  assert.deepEqual(pickByeTeams(rows, 2), [5, 3]); // 5 and 3 tie on points/GD/GF → higher OVR first
  assert.deepEqual(pickByeTeams(rows, 3), [5, 3, 1]);
  assert.deepEqual(pickByeTeams(rows, 0), []);
});
