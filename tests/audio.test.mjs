import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIOS, retryDelay, stallCheck, atcStatus, lampState, LOFI_URL, IOS_LEVELS, lofiUrl } from '../js/audio-logic.js';

test('константы', () => { assert.equal(LOFI_URL, 'https://radiorecord.hostingradio.ru/lofi96.aacp'); assert.deepEqual(IOS_LEVELS, {lofi: 0.5, atc: 1.0}); });
test('isIOS', () => { assert.ok(isIOS({userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',platform:'iPhone',maxTouchPoints:5}));
  assert.ok(isIOS({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',platform:'MacIntel',maxTouchPoints:5}));
  assert.ok(!isIOS({userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',platform:'MacIntel',maxTouchPoints:0})); });
test('retryDelay', () => { assert.equal(retryDelay(0),2000); assert.equal(retryDelay(4),30000); assert.equal(retryDelay(99),30000); });
test('stallCheck', () => { assert.ok(stallCheck({playing:true,lastProgressAt:0,now:12001})); assert.ok(!stallCheck({playing:false,lastProgressAt:0,now:99999})); assert.ok(!stallCheck({playing:true,lastProgressAt:5000,now:12000})); });
test('эфир OFF после 3 сбоев', () => { assert.equal(atcStatus({failures:2}),'live'); assert.equal(atcStatus({failures:3}),'off'); });
test('лампочка', () => { assert.equal(lampState({playing:false,buffering:true,atc:'off'}),'off'); assert.equal(lampState({playing:true,buffering:false,atc:'off'}),'blink'); assert.equal(lampState({playing:true,buffering:false,atc:'live'}),'on'); assert.equal(lampState({playing:true,buffering:true,atc:'live'}),'blink'); });

test('адрес лофи меняется на каждый запуск', () => { assert.equal(lofiUrl(5), LOFI_URL + '?nocache=5'); assert.notEqual(lofiUrl(5), lofiUrl(6)); });
