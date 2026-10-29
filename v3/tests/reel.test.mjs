import test from 'node:test';
import assert from 'node:assert/strict';
import { stepReel, blipBrightness, project, bearing, REEL_DEG_PER_SEC, SPOKES } from '../js/reel-math.js';

test('константы катушки', () => { assert.equal(REEL_DEG_PER_SEC, 30); assert.equal(SPOKES, 3); });
test('разгон до 30°/с', () => { let s={angle:0,speed:0}; for (let i=0;i<100;i++) s=stepReel(s,0.1,true); assert.ok(Math.abs(s.speed-30)<0.5); });
test('плавная остановка', () => { let s={angle:0,speed:30}; s=stepReel(s,0.1,false); assert.ok(s.speed<30 && s.speed>20); for (let i=0;i<40;i++) s=stepReel(s,0.1,false); assert.ok(s.speed<0.5); });
test('dt ограничен', () => assert.ok(stepReel({angle:0,speed:30},3600,true).angle <= 3.01));
test('угол по модулю 360', () => { const s=stepReel({angle:359,speed:30},0.1,true); assert.ok(s.angle>=0 && s.angle<360); assert.ok(Math.abs(s.angle-2)<1e-9); });
test('яркость сразу после спицы и перед следующей', () => { assert.equal(blipBrightness(90,90),1); assert.ok(Math.abs(blipBrightness(90,209.9)-0.22)<0.01); assert.equal(blipBrightness(90,210),1); });
test('яркость при угле катушки меньше пеленга', () => assert.ok(Math.abs(blipBrightness(350,10)-(1-0.78*20/120))<1e-9));
test('проекция: север вверх, восток вправо', () => { const n=project(40,-74,40,40.5,-74); assert.ok(n.y<0&&Math.abs(n.x)<1e-9); const e=project(40,-74,40,40,-73.5); assert.ok(e.x>0); assert.equal(Math.round(bearing(e.x,e.y)),90); });
test('за радиусом r > 1', () => assert.ok(project(40,-74,40,41,-74).r>1));
test('пеленг: север 0, юг 180, запад 270', () => { assert.equal(bearing(0,-1),0); assert.equal(bearing(0,1),180); assert.equal(bearing(-1,0),270); });
