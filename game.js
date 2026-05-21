'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const W = 480;
const H = 640;
canvas.width = W;
canvas.height = H;

function resizeCanvas() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width  = W * scale + 'px';
    canvas.style.height = H * scale + 'px';
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── 상수 ──────────────────────────────────────────────
const GRAVITY          = 0.38;
const JUMP_FORCE       = -7.2;
const PIPE_WIDTH       = 74;
const PIPE_GAP         = 205;  // 고정 넓은 갭
const BASE_PIPE_SPEED  = 2.9;
const PIPE_INTERVAL    = 2000; // ms
const GROUND_H         = 80;
const PLAYER_X         = 110;
const PLAYER_R         = 20;
const GAME_TITLE       = 'NS 슈리의 모험';

const ITEM_TYPES = {
    SHIELD: { color: '#4FC3F7', label: '무적',       duration: 4000 },
    DOUBLE: { color: '#FFD700', label: '×2 점수',    duration: 6000 },
    BOSS:   { color: '#CC44FF', label: '사장님의 은총', duration: 0 },
};

// ── 오디오 (Web Audio API) ────────────────────────────
let _ac = null;
function ac() {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    return _ac;
}

let masterVol = 0.4;
let bgmPlaying = false;
let bgmBeat    = 0;
let bgmTimer   = null;

function tone(freq, type, dur, vol, when = 0) {
    if (!bgmPlaying && freq === 0) return;
    try {
        const a = ac();
        const t = a.currentTime + when;
        const o = a.createOscillator();
        const g = a.createGain();
        o.connect(g); g.connect(a.destination);
        o.type = type;
        o.frequency.setValueAtTime(freq || 1, t);
        g.gain.setValueAtTime(vol * masterVol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t); o.stop(t + dur + 0.01);
    } catch(e) {}
}

// SFX
function sfxJump()   { tone(420,'sine',0.08,0.28); tone(580,'sine',0.07,0.18,0.05); }
function sfxScore()  { tone(660,'sine',0.10,0.22); tone(880,'sine',0.08,0.16,0.07); }
function sfxCoin()   { tone(900,'sine',0.09,0.25); tone(1200,'sine',0.07,0.18,0.06); }
function sfxItem()   { [440,550,660,880].forEach((f,i)=>tone(f,'sine',0.10,0.22,i*0.06)); }
function sfxBoss()   { [220,330,440,660,880].forEach((f,i)=>tone(f,'square',0.12,0.28,i*0.05)); }
function sfxBreak()  { tone(180+Math.random()*80,'sawtooth',0.07,0.35); tone(240,'square',0.05,0.28,0.03); }
function sfxDeath()  {
    [380,280,200,120].forEach((f,i)=>tone(f,'sawtooth',0.18,0.30,i*0.12));
    tone(80,'square',0.25,0.35,0.5);
}

// BGM — 경쾌한 8비트 루프
const BGM_T  = 0.145; // 박자 길이(초)
const BGM_M  = [523,659,784,659,698,784,880,784,659,523,587,659,523,0,440,523,
                587,523,659,784,0,784,659,784,880,784,698,659,523,0,523,0];
const BGM_B  = [262,0,330,0,349,0,330,0,294,0,349,0,220,0,262,0,
                294,0,330,0,392,0,349,0,440,0,349,0,262,0,220,0];

function bgmStep() {
    if (!bgmPlaying) return;
    const i = bgmBeat % BGM_M.length;
    if (BGM_M[i]) tone(BGM_M[i],'square', BGM_T*0.75, 0.07);
    if (BGM_B[i]) tone(BGM_B[i],'triangle',BGM_T*0.85,0.05);
    bgmBeat++;
    bgmTimer = setTimeout(bgmStep, BGM_T * 1000);
}
function startBGM() { if (bgmPlaying) return; bgmPlaying=true; bgmBeat=0; bgmStep(); }
function stopBGM()  { bgmPlaying=false; if(bgmTimer) clearTimeout(bgmTimer); }

// ── 게임 상태 ─────────────────────────────────────────
let state;       // 'menu' | 'playing' | 'gameover'
let score, highScore;
let animTick;    // 항상 증가 (애니메이션용)
let lastPipeTs;  // 마지막 파이프 생성 시각 (ms)
let pipeSpeed;

let shieldActive, shieldTimer;
let doubleActive, doubleTimer;
let bossRush;      // 돌진 중
let bossRushLeft;  // 남은 파이프 수
let bossReturn;    // 귀환 중
let bossFlash;     // 화면 플래시 (0~1)

let player, pipes, coins, items, particles, clouds;

highScore = parseInt(localStorage.getItem('hsCatGame') || '0');

// ── 기록 시스템 ───────────────────────────────────────
const RECORDS_KEY = 'recordsCatGame';
const MAX_RECORDS = 10;

function loadRecords() {
    try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]'); }
    catch(e) { return []; }
}
function saveRecord(name, sc) {
    const list = loadRecords();
    list.push({ name: name.trim() || '익명', score: sc, date: new Date().toLocaleDateString('ko-KR') });
    list.sort((a, b) => b.score - a.score);
    if (list.length > MAX_RECORDS) list.length = MAX_RECORDS;
    localStorage.setItem(RECORDS_KEY, JSON.stringify(list));
    highScore = list[0]?.score || highScore;
    localStorage.setItem('hsCatGame', highScore);
}
function getTopRecords(n = 5) { return loadRecords().slice(0, n); }

// ── 이름 입력 오버레이 ────────────────────────────────
let nameInputActive = false;

function showNameInput() {
    if (score === 0) return; // 점수 0이면 건너뜀
    nameInputActive = true;
    const ov  = document.getElementById('name-overlay');
    const val = document.getElementById('name-score-val');
    const inp = document.getElementById('name-input');
    val.textContent = score;
    inp.value = '';
    ov.classList.add('visible');
    setTimeout(() => inp.focus(), 100);
}
function hideNameInput() {
    nameInputActive = false;
    document.getElementById('name-overlay').classList.remove('visible');
}

// 저장 / 건너뛰기 버튼 이벤트
document.getElementById('name-submit').addEventListener('click', () => {
    saveRecord(document.getElementById('name-input').value, score);
    hideNameInput();
});
document.getElementById('name-skip').addEventListener('click', () => { hideNameInput(); });
document.getElementById('name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        saveRecord(document.getElementById('name-input').value, score);
        hideNameInput();
    }
});

// ── 초기화 ────────────────────────────────────────────
function resetGame() {
    score       = 0;
    animTick    = 0;
    lastPipeTs  = -PIPE_INTERVAL;
    pipeSpeed   = BASE_PIPE_SPEED;

    shieldActive  = false; shieldTimer = 0;
    doubleActive  = false; doubleTimer = 0;
    bossRush      = false;
    bossRushLeft  = 0;
    bossReturn    = false;
    bossFlash     = 0;

    player = {
        x: PLAYER_X, y: H / 2 - 40,
        vy: 0, angle: 0,
        alive: true, wingPhase: 0,
    };

    pipes     = [];
    coins     = [];
    items     = [];
    particles = [];
    clouds    = buildClouds();
}

function buildClouds() {
    return Array.from({ length: 6 }, () => ({
        x:     Math.random() * W,
        y:     30 + Math.random() * H * 0.38,
        speed: 0.28 + Math.random() * 0.38,
        scale: 0.55 + Math.random() * 0.85,
    }));
}

// ── 스폰 ──────────────────────────────────────────────
function spawnPipe(now) {
    lastPipeTs = now;
    const gap    = PIPE_GAP;
    const minTop = 70;
    const maxTop = H - GROUND_H - gap - 70;
    const topH   = minTop + Math.random() * (maxTop - minTop);

    pipes.push({ x: W + PIPE_WIDTH, topH, gap, scored: false });

    // 코인 (갭 안에 1~3개)
    const gapCY   = topH + gap / 2;
    const nCoins  = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nCoins; i++) {
        coins.push({
            x: W + PIPE_WIDTH + 18 + i * 26,
            y: gapCY + (Math.random() - 0.5) * (gap * 0.35),
            phase: Math.random() * Math.PI * 2,
            done: false,
        });
    }

    // 아이템 (35% 확률, 균등 분배)
    if (Math.random() < 0.35) {
        // SHIELD 33%, DOUBLE 33%, BOSS 33%
        const r    = Math.random();
        const type = r < 0.333 ? 'SHIELD' : r < 0.666 ? 'DOUBLE' : 'BOSS';
        items.push({ x: W + PIPE_WIDTH + 37, y: gapCY - gap * 0.1, type, phase: 0, done: false });
    }
}

const BOSS_RUSH_SPEED   = 13;  // 돌진 시 플레이어 전진 속도 (px/frame)
const BOSS_RETURN_SPEED = 9;   // 귀환 속도
const BOSS_PIPE_SPACING = 90;  // 돌진용 파이프 간격

// ── 업데이트 ──────────────────────────────────────────
function update(now, dt) {
    animTick++;
    pipeSpeed = BASE_PIPE_SPEED + score * 0.03;
    const spd = pipeSpeed;

    const invincible = shieldActive || bossRush || bossReturn;

    // ── 보스 돌진 중: 플레이어 전진 ──
    if (bossRush) {
        player.x     += BOSS_RUSH_SPEED;
        player.vy    *= 0.72;           // 수직 움직임 감쇠
        player.y     += player.vy;
        player.angle  = -28;            // 앞으로 숙임
        player.wingPhase += 0.55;

        // 범위를 벗어나지 않게
        player.y = Math.max(PLAYER_R, Math.min(H - GROUND_H - PLAYER_R, player.y));

        // 속도선 파티클 (뒤에서 앞으로)
        if (animTick % 2 === 0) {
            for (let k = 0; k < 3; k++) {
                particles.push({
                    x: player.x - 10 - Math.random() * 40,
                    y: player.y + (Math.random() - 0.5) * 50,
                    vx: -(6 + Math.random() * 5), vy: 0,
                    color: `hsl(${280 + Math.random() * 60},100%,80%)`,
                    size: 1.5 + Math.random() * 2,
                    life: 1, decay: 0.08, text: null,
                });
            }
        }

        // 파이프와 겹치면 박살
        for (let i = pipes.length - 1; i >= 0; i--) {
            const p = pipes[i];
            if (!p.broken &&
                player.x + PLAYER_R - 4 > p.x &&
                player.x - PLAYER_R + 4 < p.x + PIPE_WIDTH) {
                p.broken = true;
                breakPipe(p);
                pipes.splice(i, 1);
                bossRushLeft--;
                if (bossRushLeft <= 0) {
                    bossRush   = false;
                    bossReturn = true;
                }
            }
        }

        // 파이프 없으면 더 기다릴 필요 없음
        if (bossRush && pipes.filter(p => !p.broken && p.x > player.x - 10).length === 0) {
            bossRush   = false;
            bossReturn = true;
        }

    // ── 귀환 중 ──
    } else if (bossReturn) {
        player.x -= BOSS_RETURN_SPEED;
        player.vy *= 0.8;
        player.y  += player.vy;
        player.angle = Math.max(-10, player.angle - 2);
        player.wingPhase += 0.35;
        player.y = Math.max(PLAYER_R, Math.min(H - GROUND_H - PLAYER_R, player.y));

        if (player.x <= PLAYER_X) {
            player.x   = PLAYER_X;
            bossReturn = false;
        }

    // ── 일반 물리 ──
    } else if (player.alive) {
        player.vy    += GRAVITY;
        player.y     += player.vy;
        player.angle  = Math.max(-28, Math.min(75, player.vy * 3.6));
        player.wingPhase += 0.28;

        if (player.y + PLAYER_R > H - GROUND_H) {
            if (invincible) { player.y = H - GROUND_H - PLAYER_R; player.vy = 0; }
            else killPlayer();
        }
        if (player.y - PLAYER_R < 0) { player.y = PLAYER_R; player.vy = 0; }
    }

    // 파이프 스폰
    if (now - lastPipeTs >= PIPE_INTERVAL) spawnPipe(now);

    // 파이프 이동 & 충돌 & 점수
    for (let i = pipes.length - 1; i >= 0; i--) {
        const p = pipes[i];
        p.x -= spd;

        if (!p.scored && p.x + PIPE_WIDTH < player.x) {
            p.scored = true;
            if (!bossRush) {
                addScore(1);
                sfxScore();
                floatText('+' + (doubleActive ? 2 : 1), player.x + 28, player.y - 18, '#FFD700');
            }
        }

        if (player.alive && !invincible && hitPipe(p)) killPlayer();
        if (p.x + PIPE_WIDTH < 0) pipes.splice(i, 1);
    }

    // 코인
    for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i];
        c.x -= spd;
        c.phase += 0.08;
        if (!c.done && dist(player.x, player.y, c.x, c.y) < PLAYER_R + 11) {
            c.done = true;
            addScore(1);
            sfxCoin();
            burst(c.x, c.y, '#FFD700', 6);
        }
        if (c.x < -20) coins.splice(i, 1);
    }

    // 아이템
    for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.x -= spd;
        it.phase += 0.05;
        if (!it.done && dist(player.x, player.y, it.x, it.y) < PLAYER_R + 17) {
            it.done = true;
            activateItem(it.type);
            burst(it.x, it.y, ITEM_TYPES[it.type].color, 10);
            it.type === 'BOSS' ? sfxBoss() : sfxItem();
        }
        if (it.x < -30) items.splice(i, 1);
    }

    // 타이머
    if (shieldActive && (shieldTimer -= dt) <= 0) shieldActive = false;
    if (doubleActive && (doubleTimer -= dt) <= 0) doubleActive = false;
    if (bossFlash > 0) bossFlash = Math.max(0, bossFlash - dt * 0.003);

    // 구름
    for (const cl of clouds) {
        cl.x -= cl.speed * (bossRush ? 3 : 1);
        if (cl.x < -120) cl.x = W + 120;
    }

    // 파티클
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.18;
        p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function addScore(n) {
    score += doubleActive ? n * 2 : n;
}

function activateItem(type) {
    if (type === 'SHIELD') { shieldActive = true; shieldTimer = ITEM_TYPES.SHIELD.duration; }
    if (type === 'DOUBLE') { doubleActive = true; doubleTimer = ITEM_TYPES.DOUBLE.duration; }
    if (type === 'BOSS')   { activateBoss(); }
}

function activateBoss() {
    bossRush     = true;
    bossRushLeft = 5;
    bossFlash    = 1.0;
    items.length = 0;  // 돌진 중 아이템 충돌 방지

    // 기존 파이프 제거 후 돌진용 파이프 5개 등간격 배치
    pipes.length = 0;
    coins.length = 0;
    for (let i = 0; i < 5; i++) {
        const x      = player.x + 60 + i * BOSS_PIPE_SPACING;
        const minTop = 80;
        const maxTop = H - GROUND_H - PIPE_GAP - 80;
        const topH   = minTop + Math.random() * (maxTop - minTop);
        pipes.push({ x, topH, gap: PIPE_GAP, scored: false, broken: false, rushPipe: true });
    }

    // 출발 폭발 파티클
    const cols = ['#FFD700','#FF88FF','#CC44FF','#FFFFFF','#FF44AA'];
    for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = 3 + Math.random() * 7;
        particles.push({
            x: player.x, y: player.y,
            vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            color: cols[i % cols.length],
            size: 3 + Math.random() * 4,
            life: 1, decay: 0.014 + Math.random() * 0.012, text: null,
        });
    }

    floatText('✦ 사장님의 은총! ✦', W / 2, H / 2 - 20, '#FFD700', 20);
}

// 파이프 박살 이펙트
function breakPipe(p) {
    addScore(1);
    const cx  = p.x + PIPE_WIDTH / 2;
    const botY = p.topH + p.gap;

    // 파이프 잔해 파티클 (초록 사각형 느낌)
    const debrisColors = ['#5CB85C','#3E9142','#8BC34A','#2E7D32'];
    for (let i = 0; i < 18; i++) {
        const fromTop = Math.random() < 0.5;
        const oy      = fromTop
            ? Math.random() * p.topH
            : botY + Math.random() * (H - GROUND_H - botY);
        const spd = 3 + Math.random() * 6;
        const ang = Math.random() * Math.PI * 2;
        particles.push({
            x: cx + (Math.random() - 0.5) * PIPE_WIDTH,
            y: oy,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd - 2,
            color: debrisColors[i % debrisColors.length],
            size: 4 + Math.random() * 6,
            life: 1, decay: 0.022 + Math.random() * 0.018, text: null,
        });
    }
    // 충격파 흰 파티클
    for (let i = 0; i < 10; i++) {
        const ang = (Math.PI * 2 / 10) * i;
        particles.push({
            x: cx, y: H / 2,
            vx: Math.cos(ang) * (4 + Math.random() * 4),
            vy: Math.sin(ang) * (4 + Math.random() * 4),
            color: '#FFFFFF',
            size: 3 + Math.random() * 3,
            life: 1, decay: 0.035, text: null,
        });
    }
    // 점수 팝업
    sfxBreak();
    floatText('+' + (doubleActive ? 2 : 1), cx, player.y - 20, '#FFD700', 16);
    bossFlash = Math.max(bossFlash, 0.45);
}

// ── 충돌 ──────────────────────────────────────────────
function hitPipe(p) {
    const r = PLAYER_R - 4;
    const px = player.x, py = player.y;
    if (px + r > p.x && px - r < p.x + PIPE_WIDTH) {
        if (py - r < p.topH || py + r > p.topH + p.gap) return true;
    }
    return false;
}

function dist(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
}

// ── 파티클 ────────────────────────────────────────────
function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 / n) * i;
        particles.push({
            x, y,
            vx: Math.cos(a) * (1.5 + Math.random() * 2.5),
            vy: Math.sin(a) * (1.5 + Math.random() * 2.5),
            color, size: 3 + Math.random() * 3,
            life: 1, decay: 0.03 + Math.random() * 0.02,
            text: null,
        });
    }
}

function floatText(text, x, y, color, size = 15) {
    particles.push({
        x, y, vx: 0.5, vy: -2.4,
        color, size, life: 1, decay: 0.016, text,
    });
}

function killPlayer() {
    player.alive = false;
    // 죽음 폭발
    for (let i = 0; i < 22; i++) {
        const a = (Math.PI * 2 / 22) * i;
        const spd2 = 2.5 + Math.random() * 3.5;
        particles.push({
            x: player.x, y: player.y,
            vx: Math.cos(a) * spd2, vy: Math.sin(a) * spd2,
            color: ['#FF6B6B','#FFA07A','#FFD700','#FF4500'][i % 4],
            size: 4 + Math.random() * 4,
            life: 1, decay: 0.018 + Math.random() * 0.015, text: null,
        });
    }

    sfxDeath();
    stopBGM();
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('hsCatGame', highScore);
    }
    setTimeout(() => {
        state = 'gameover';
        setTimeout(showNameInput, 350);
    }, 900);
}

// ── 그리기 헬퍼 ───────────────────────────────────────
function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// ── 배경 / 구름 ───────────────────────────────────────
function drawBg() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,   '#2A7FC0');
    g.addColorStop(0.6, '#5BAEE0');
    g.addColorStop(1,   '#9DCFF0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
}

function drawClouds() {
    ctx.save();
    for (const cl of clouds) {
        ctx.globalAlpha = 0.88;
        ctx.fillStyle = 'white';
        const s = cl.scale;
        ctx.beginPath();
        ctx.arc(cl.x,          cl.y,          24 * s, 0, Math.PI * 2);
        ctx.arc(cl.x + 20 * s, cl.y - 11 * s, 19 * s, 0, Math.PI * 2);
        ctx.arc(cl.x + 42 * s, cl.y,           21 * s, 0, Math.PI * 2);
        ctx.arc(cl.x + 21 * s, cl.y + 6  * s,  17 * s, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

function drawGround() {
    // 잔디
    ctx.fillStyle = '#7CB63A';
    ctx.fillRect(0, H - GROUND_H, W, 18);
    // 잔디 결
    ctx.fillStyle = '#689F28';
    for (let x = 4; x < W; x += 18) ctx.fillRect(x, H - GROUND_H, 9, 7);
    // 흙
    ctx.fillStyle = '#A1714E';
    ctx.fillRect(0, H - GROUND_H + 18, W, GROUND_H - 18);
}

// ── 파이프 ────────────────────────────────────────────
function drawPipe(p) {
    const botY = p.topH + p.gap;
    const botH = H - GROUND_H - botY;

    // 윗 파이프 몸통
    ctx.fillStyle = '#3DAA3D';
    ctx.fillRect(p.x, 0, PIPE_WIDTH, p.topH);
    // 윗 파이프 캡
    ctx.fillStyle = '#237823';
    ctx.fillRect(p.x - 6, p.topH - 30, PIPE_WIDTH + 12, 30);
    // 아랫 파이프 몸통
    ctx.fillStyle = '#3DAA3D';
    ctx.fillRect(p.x, botY, PIPE_WIDTH, botH);
    // 아랫 파이프 캡
    ctx.fillStyle = '#237823';
    ctx.fillRect(p.x - 6, botY, PIPE_WIDTH + 12, 30);
    // 광택
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(p.x + 9, 0, 13, p.topH);
    ctx.fillRect(p.x + 9, botY, 13, botH);
    // 테두리 (윤곽 선명하게)
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x, 0, PIPE_WIDTH, p.topH);
    ctx.strokeRect(p.x - 6, p.topH - 30, PIPE_WIDTH + 12, 30);
    ctx.strokeRect(p.x, botY, PIPE_WIDTH, botH);
    ctx.strokeRect(p.x - 6, botY, PIPE_WIDTH + 12, 30);
}

// ── 코인 ──────────────────────────────────────────────
function drawCoin(c) {
    const sx = Math.abs(Math.cos(c.phase));
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(sx, 1);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#FFD700';
    ctx.fill();
    ctx.strokeStyle = '#FFA000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-3, -3, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
    ctx.restore();
}

// ── 아이템 ────────────────────────────────────────────
function drawItem(it) {
    const info = ITEM_TYPES[it.type];
    const bob  = Math.sin(it.phase * 2) * 3;
    ctx.save();
    ctx.translate(it.x, it.y + bob);
    ctx.shadowBlur = 18; ctx.shadowColor = info.color;
    ctx.fillStyle = info.color;
    rrect(-16, -16, 32, 32, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle   = 'white';
    ctx.font        = 'bold 13px Segoe UI';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.type === 'SHIELD' ? '★' : it.type === 'DOUBLE' ? '×2' : '👑', 0, 0);
    ctx.restore();
}

// ── 플레이어 (독수리 캐릭터) ─────────────────────────
function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle * Math.PI / 180);

    // 무적 실드
    if (shieldActive) {
        ctx.save();
        ctx.globalAlpha = 0.35 + Math.sin(animTick * 0.18) * 0.18;
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_R + 13, 0, Math.PI * 2);
        ctx.strokeStyle = '#4FC3F7';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    const wf = player.wingPhase;

    // ── 꼬리 깃털 ──
    ctx.save();
    ctx.translate(-16, 6);
    for (let i = 0; i < 4; i++) {
        const angle = (-0.3 + i * 0.2);
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-14 - i * 2, 3 + i);
        ctx.lineWidth = 3 - i * 0.4;
        ctx.strokeStyle = '#2C1200';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
    }
    ctx.restore();

    // ── 날개 (위아래로 퍼덕) ──
    const wingBeat = Math.sin(wf) * 10;
    ctx.save();
    // 날개 본체 (어두운 갈색)
    ctx.beginPath();
    ctx.moveTo(-2, 2);
    ctx.bezierCurveTo(-6, -4, -24, wingBeat - 16, -32, wingBeat - 6);
    ctx.bezierCurveTo(-28, wingBeat + 4, -14, wingBeat + 10, -2, 10);
    ctx.closePath();
    const wingG = ctx.createLinearGradient(-32, 0, -2, 0);
    wingG.addColorStop(0, '#1A0800');
    wingG.addColorStop(0.6, '#3B1500');
    wingG.addColorStop(1, '#5C2500');
    ctx.fillStyle = wingG;
    ctx.fill();
    // 날개 끝 호박색 광택
    ctx.beginPath();
    ctx.moveTo(-24, wingBeat - 13);
    ctx.bezierCurveTo(-30, wingBeat - 14, -34, wingBeat - 6, -28, wingBeat);
    ctx.bezierCurveTo(-24, wingBeat + 3, -18, wingBeat - 4, -20, wingBeat - 10);
    ctx.fillStyle = 'rgba(200,90,10,0.55)';
    ctx.fill();
    // 날개 깃털 선
    for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const wx = -2 + (-30 + 2) * t;
        const wy = 6 + (wingBeat - 6 - 6) * t;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx - 4, wy - 5 - i);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
    ctx.restore();

    // ── 몸통 (진한 갈색, 둥글고 통통하게) ──
    ctx.beginPath();
    ctx.ellipse(0, 3, 17, 15, 0, 0, Math.PI * 2);
    const bodyG = ctx.createRadialGradient(-5, -2, 3, 0, 3, 20);
    bodyG.addColorStop(0, '#5C2500');
    bodyG.addColorStop(0.5, '#3B1500');
    bodyG.addColorStop(1, '#1A0800');
    ctx.fillStyle = bodyG;
    ctx.fill();

    // 몸통 비늘 질감 (짧은 호)
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    for (let row = 0; row < 3; row++) {
        for (let col = -1; col < 2; col++) {
            const sx = col * 8 + (row % 2) * 4;
            const sy = -4 + row * 7;
            ctx.beginPath();
            ctx.arc(sx, sy + 3, 5, Math.PI + 0.3, -0.3);
            ctx.stroke();
        }
    }

    // ── 가슴 흰털 ──
    ctx.beginPath();
    ctx.ellipse(4, 6, 7, 9, -0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(235,225,200,0.5)';
    ctx.fill();

    // ── 머리 (흰색, 대머리독수리) ──
    ctx.beginPath();
    ctx.arc(7, -11, 13, 0, Math.PI * 2);
    const headG = ctx.createRadialGradient(4, -14, 2, 7, -11, 13);
    headG.addColorStop(0, '#FFFFFF');
    headG.addColorStop(1, '#E8E0D0');
    ctx.fillStyle = headG;
    ctx.fill();
    // 머리 아랫부분 목 연결 (어두운 갈색)
    ctx.beginPath();
    ctx.ellipse(2, -2, 9, 7, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#3B1500';
    ctx.fill();

    // ── 부리 (노란색, 갈고리형) ──
    ctx.beginPath();
    ctx.moveTo(17, -13);
    ctx.lineTo(26, -10);
    ctx.lineTo(24, -7);
    ctx.lineTo(17, -9);
    ctx.closePath();
    ctx.fillStyle = '#E8A800';
    ctx.fill();
    // 부리 끝 갈고리
    ctx.beginPath();
    ctx.moveTo(24, -7);
    ctx.quadraticCurveTo(27, -6, 25, -4);
    ctx.quadraticCurveTo(22, -5, 22, -7);
    ctx.fillStyle = '#CC8800';
    ctx.fill();
    // 부리 선
    ctx.beginPath();
    ctx.moveTo(17, -11);
    ctx.lineTo(24, -8.5);
    ctx.strokeStyle = '#CC8800';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── 눈 ──
    // 눈 흰자
    ctx.beginPath();
    ctx.ellipse(13, -14, 5.5, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#F0E8D0';
    ctx.fill();
    // 눈동자
    ctx.beginPath();
    ctx.arc(14, -14, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
    // 눈 하이라이트
    ctx.beginPath();
    ctx.arc(15.2, -15.2, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    // ── 화난 눈썹 ──
    ctx.beginPath();
    ctx.moveTo(8, -20);
    ctx.lineTo(18, -17.5);
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = '#2C1200';
    ctx.lineCap = 'round';
    ctx.stroke();

    // ── 발 (비행 중 접힌 상태) ──
    ctx.save();
    ctx.translate(4, 16);
    ctx.strokeStyle = '#CC7700';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    // 다리
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(7, 7); ctx.stroke();
    // 발톱
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#1a1a2e';
    [[-4,7],[0,9],[4,7],[7,5]].forEach(([tx, ty]) => {
        ctx.beginPath(); ctx.moveTo(3, 7); ctx.lineTo(tx, ty + 3); ctx.stroke();
    });
    ctx.restore();

    ctx.restore();
}

// ── 파티클 ────────────────────────────────────────────
function drawParticles() {
    for (const p of particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        if (p.text) {
            ctx.fillStyle = p.color;
            ctx.font = `bold ${p.size}px Segoe UI`;
            ctx.textAlign = 'center';
            ctx.fillText(p.text, p.x, p.y);
        } else {
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

// ── HUD ───────────────────────────────────────────────
function drawHUD() {
    // 좌상단 게임 이름
    ctx.save();
    ctx.shadowBlur = 6; ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.fillStyle    = 'rgba(255,255,255,0.88)';
    ctx.font         = 'bold 13px Segoe UI';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(GAME_TITLE, 12, 12);
    ctx.shadowBlur   = 0;
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    // 중앙 점수
    ctx.save();
    ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.fillStyle = 'white';
    ctx.font      = 'bold 38px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(score, W / 2, 60);
    ctx.shadowBlur = 0;
    ctx.restore();

    // 아이템 타이머 바
    let ty = 96;
    if (shieldActive) { drawTimerBar('무적',    ITEM_TYPES.SHIELD.color, shieldTimer / ITEM_TYPES.SHIELD.duration, ty); ty += 34; }
    if (doubleActive) { drawTimerBar('×2 점수', ITEM_TYPES.DOUBLE.color, doubleTimer / ITEM_TYPES.DOUBLE.duration, ty); ty += 34; }
}

function drawTimerBar(label, color, ratio, y) {
    const bw = 118, bx = W - bw - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    rrect(bx - 4, y - 14, bw + 8, 26, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx, y + 2, bw, 7);
    ctx.fillStyle = color;
    ctx.fillRect(bx, y + 2, bw * Math.max(0, ratio), 7);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 11px Segoe UI';
    ctx.textAlign = 'left';
    ctx.fillText(label, bx, y);
}

// ── 메뉴 화면 ─────────────────────────────────────────
function drawMenu() {
    // 배경 그라데이션 (선명한 하늘)
    const bgG = ctx.createLinearGradient(0, 0, 0, H);
    bgG.addColorStop(0,   '#1A5FB0');
    bgG.addColorStop(0.5, '#2A7FC0');
    bgG.addColorStop(1,   '#7ABCE0');
    ctx.fillStyle = bgG;
    ctx.fillRect(0, 0, W, H);

    drawClouds();
    drawGround();

    // ── 타이틀 패널 (반투명 카드) ──
    ctx.save();
    ctx.shadowBlur = 30; ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.fillStyle  = 'rgba(255,255,255,0.28)';
    rrect(W / 2 - 178, 62, 356, 188, 28);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 카드 테두리
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth   = 1.5;
    rrect(W / 2 - 178, 62, 356, 188, 28);
    ctx.stroke();

    // 부제 (위)
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font      = '15px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('✦  독수리 슈리의 대모험  ✦', W / 2, 93);

    // 구분선
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(W/2 - 130, 102); ctx.lineTo(W/2 + 130, 102); ctx.stroke();

    // 메인 타이틀
    ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(255,200,50,0.7)';
    ctx.fillStyle  = '#FFFFFF';
    ctx.font       = 'bold 44px Segoe UI';
    ctx.fillText('NS 슈리의', W / 2, 152);
    ctx.font       = 'bold 48px Segoe UI';
    ctx.fillStyle  = '#FFE066';
    ctx.fillText('모험', W / 2, 205);
    ctx.shadowBlur = 0;
    ctx.restore();

    // ── 최고 점수 배지 ──
    if (highScore > 0) {
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(255,200,0,0.4)';
        ctx.fillStyle  = 'rgba(30,20,0,0.45)';
        rrect(W / 2 - 92, 270, 184, 38, 19);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,215,0,0.5)';
        ctx.lineWidth   = 1.2;
        rrect(W / 2 - 92, 270, 184, 38, 19);
        ctx.stroke();
        ctx.fillStyle    = '#FFD700';
        ctx.font         = 'bold 18px Segoe UI';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`🏆  최고 점수: ${highScore}`, W / 2, 289);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
    }

    // ── 시작 버튼 ──
    const pulse = 1 + Math.sin(animTick * 0.065) * 0.035;
    ctx.save();
    ctx.translate(W / 2, highScore > 0 ? 370 : 352);
    ctx.scale(pulse, pulse);
    ctx.shadowBlur = 26; ctx.shadowColor = 'rgba(255,80,80,0.6)';
    // 버튼 본체
    const btnG = ctx.createLinearGradient(0, -28, 0, 28);
    btnG.addColorStop(0, '#FF7676');
    btnG.addColorStop(1, '#E83030');
    ctx.fillStyle = btnG;
    rrect(-118, -28, 236, 56, 28);
    ctx.fill();
    // 버튼 상단 하이라이트
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    rrect(-118, -28, 236, 28, 28);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle    = 'white';
    ctx.font         = 'bold 20px Segoe UI';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▶  게임 시작', 0, 0);
    ctx.restore();

    // 조작 안내
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.75)';
    ctx.textBaseline = 'alphabetic';
    ctx.font         = '13px Segoe UI';
    ctx.textAlign    = 'center';
    ctx.fillText('클릭 또는 스페이스바로 점프!', W / 2, highScore > 0 ? 414 : 396);
    ctx.restore();

    drawItemGuide();
}

function drawItemGuide() {
    ctx.save();
    ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.fillStyle  = 'rgba(0,30,80,0.45)';
    rrect(18, 478, W - 36, 136, 14);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth   = 1;
    rrect(18, 478, W - 36, 136, 14);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font      = 'bold 13px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText('— 아이템 안내 —', W / 2, 500);

    const entries = [
        { color: '#4FC3F7', icon: '★',  label: '무적',         desc: '4초간 파이프 통과'  },
        { color: '#FFD700', icon: '×2', label: '×2 점수',       desc: '6초간 점수 2배'    },
        { color: '#CC44FF', icon: '👑', label: '사장님의 은총', desc: '+5점 & 파이프 소멸' },
    ];

    const sp = (W - 36) / 3;
    entries.forEach((e, i) => {
        const x = 18 + sp * i + sp / 2;

        ctx.shadowBlur = 10; ctx.shadowColor = e.color;
        ctx.fillStyle  = e.color;
        rrect(x - 18, 512, 36, 36, 7);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle    = 'white';
        ctx.font         = 'bold 15px Segoe UI';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.icon, x, 530);
        ctx.textBaseline = 'alphabetic';

        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font      = 'bold 12px Segoe UI';
        ctx.fillText(e.label, x, 565);

        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font      = '11px Segoe UI';
        ctx.fillText(e.desc, x, 582);
    });
}

// ── 게임 오버 화면 ────────────────────────────────────
const GO_BTN_RESTART_Y = 530;
const GO_BTN_HOME_Y    = 590;

function drawGameOver() {
    if (nameInputActive) return; // 이름 입력 중엔 숨김

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);

    // ── 패널 ──
    ctx.save();
    ctx.shadowBlur = 24; ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.fillStyle  = 'white';
    rrect(W / 2 - 168, 28, 336, 580, 22);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // 상단 타이틀 바
    ctx.save();
    const hdrG = ctx.createLinearGradient(W/2-168, 28, W/2+168, 28);
    hdrG.addColorStop(0, '#FF5252'); hdrG.addColorStop(1, '#FF8A65');
    ctx.fillStyle = hdrG;
    rrect(W / 2 - 168, 28, 336, 64, 22);
    ctx.fill();
    ctx.fillStyle    = 'white';
    ctx.font         = 'bold 30px Segoe UI';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('게임 오버', W / 2, 60);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    // 점수
    ctx.fillStyle = '#888'; ctx.font = '15px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('이번 점수', W / 2, 122);
    ctx.fillStyle = '#FF5252'; ctx.font = 'bold 58px Segoe UI';
    ctx.fillText(score, W / 2, 182);

    const recs    = getTopRecords();
    const myRank  = recs.findIndex(r => r.score === score && r.name !== undefined);
    const isNewHi = score > 0 && score >= (recs[0]?.score ?? 0);
    ctx.font      = 'bold 15px Segoe UI';
    ctx.fillStyle = isNewHi ? '#FF8C00' : '#AAA';
    ctx.fillText(isNewHi ? '🏆 신기록!' : (highScore > 0 ? `최고: ${highScore}점` : ''), W / 2, 210);

    // ── 구분선 ──
    ctx.strokeStyle = '#EEE'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W/2-130, 226); ctx.lineTo(W/2+130, 226); ctx.stroke();

    // ── 순위표 ──
    ctx.fillStyle = '#555'; ctx.font = 'bold 13px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('🏅 명예의 전당', W / 2, 248);

    const top = getTopRecords(5);
    if (top.length === 0) {
        ctx.fillStyle = '#BBB'; ctx.font = '13px Segoe UI';
        ctx.fillText('아직 기록이 없습니다', W / 2, 290);
    } else {
        const rankColors = ['#FFD700','#C0C0C0','#CD7F32','#AAA','#AAA'];
        top.forEach((r, i) => {
            const ry = 272 + i * 38;
            const isMe = !nameInputActive && r.score === score;

            // 내 점수 하이라이트
            if (isMe) {
                ctx.fillStyle = 'rgba(255,200,50,0.12)';
                rrect(W/2 - 145, ry - 14, 290, 30, 6);
                ctx.fill();
            }

            // 순위 뱃지
            ctx.fillStyle = rankColors[i];
            ctx.font      = 'bold 14px Segoe UI';
            ctx.textAlign = 'center';
            ctx.fillText(i < 3 ? ['🥇','🥈','🥉'][i] : `${i+1}.`, W/2 - 120, ry + 4);

            // 이름
            ctx.fillStyle = '#333'; ctx.font = `${isMe ? 'bold' : ''} 14px Segoe UI`;
            ctx.textAlign = 'left';
            ctx.fillText(r.name.slice(0, 8), W/2 - 95, ry + 4);

            // 점수
            ctx.fillStyle = '#FF5252'; ctx.font = 'bold 14px Segoe UI';
            ctx.textAlign = 'right';
            ctx.fillText(r.score + '점', W/2 + 140, ry + 4);

            // 날짜
            ctx.fillStyle = '#CCC'; ctx.font = '11px Segoe UI';
            ctx.fillText(r.date, W/2 + 140, ry + 17);
        });
    }

    // ── 버튼 ──
    const pulse = 1 + Math.sin(animTick * 0.065) * 0.035;

    // 다시 시작
    ctx.save();
    ctx.translate(W / 2, GO_BTN_RESTART_Y);
    ctx.scale(pulse, pulse);
    ctx.shadowBlur = 14; ctx.shadowColor = '#4CAF50';
    const g1 = ctx.createLinearGradient(0,-24,0,24);
    g1.addColorStop(0,'#66BB6A'); g1.addColorStop(1,'#388E3C');
    ctx.fillStyle = g1;
    rrect(-130, -24, 260, 48, 24);
    ctx.fill();
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'white';
    ctx.font         = 'bold 19px Segoe UI';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▶  다시 시작', 0, 0);
    ctx.restore();

    // 홈으로
    ctx.save();
    ctx.translate(W / 2, GO_BTN_HOME_Y);
    ctx.shadowBlur = 10; ctx.shadowColor = '#5C6BC0';
    const g2 = ctx.createLinearGradient(0,-22,0,22);
    g2.addColorStop(0,'#7986CB'); g2.addColorStop(1,'#3949AB');
    ctx.fillStyle = g2;
    rrect(-130, -22, 260, 44, 22);
    ctx.fill();
    ctx.shadowBlur   = 0;
    ctx.fillStyle    = 'white';
    ctx.font         = 'bold 19px Segoe UI';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏠  홈으로', 0, 0);
    ctx.restore();
}

// ── 전체 렌더 ─────────────────────────────────────────
function render() {
    drawBg();
    drawClouds();
    for (const p of pipes)  drawPipe(p);
    for (const c of coins)  if (!c.done) drawCoin(c);
    for (const it of items) if (!it.done) drawItem(it);
    drawGround();
    if (player.alive) drawPlayer();
    drawParticles();

    // 사장님의 은총 플래시 오버레이
    if (bossFlash > 0) {
        const px = bossRush || bossReturn ? player.x : W / 2;
        const py = bossRush || bossReturn ? player.y : H / 2;
        const flashG = ctx.createRadialGradient(px, py, 0, px, py, W);
        flashG.addColorStop(0,   `rgba(255,220,255,${bossFlash * 0.8})`);
        flashG.addColorStop(0.4, `rgba(180,80,255,${bossFlash * 0.4})`);
        flashG.addColorStop(1,   `rgba(60,0,140,${bossFlash * 0.1})`);
        ctx.fillStyle = flashG;
        ctx.fillRect(0, 0, W, H);

        // 방사형 빛줄기 (돌진 중에만)
        if ((bossRush || bossReturn) && bossFlash > 0.15) {
            ctx.save();
            ctx.translate(px, py);
            ctx.globalAlpha = bossFlash * 0.45;
            for (let i = 0; i < 10; i++) {
                const a = (Math.PI * 2 / 10) * i + animTick * 0.06;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(Math.cos(a) * W, Math.sin(a) * W);
                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth   = 1.5 + bossFlash * 3;
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            ctx.restore();
        }
    }

    drawHUD();
}

// ── 입력 ──────────────────────────────────────────────
let _cx = -1, _cy = -1; // 마지막 캔버스 클릭 좌표

function canvasCoords(e) {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
        x: (src.clientX - r.left) * (W / r.width),
        y: (src.clientY - r.top)  * (H / r.height),
    };
}

function handleInput(x = -1, y = -1) {
    if (nameInputActive) return;
    if (state === 'menu') {
        state = 'playing';
        resetGame();
        startBGM();
    } else if (state === 'playing') {
        if (player.alive) { player.vy = JUMP_FORCE; sfxJump(); }
    } else if (state === 'gameover') {
        // 홈 버튼 클릭
        if (y > GO_BTN_HOME_Y - 26 && y < GO_BTN_HOME_Y + 26) {
            state = 'menu';
        } else {
            // 다시 시작 (버튼 클릭 or 스페이스)
            state = 'playing';
            resetGame();
            startBGM();
        }
    }
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); handleInput(); }
});
canvas.addEventListener('click', e => {
    const {x, y} = canvasCoords(e); _cx = x; _cy = y;
    handleInput(x, y);
});
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const {x, y} = canvasCoords(e); _cx = x; _cy = y;
    handleInput(x, y);
}, { passive: false });

// ── 게임 루프 ─────────────────────────────────────────
let lastTs = 0;

function loop(ts) {
    const dt = Math.min(ts - lastTs, 50); // 최대 50ms (탭 비활성화 대비)
    lastTs = ts;
    animTick++;

    if (state === 'playing') {
        update(ts, dt);
        render();
    } else if (state === 'menu') {
        // 메뉴에서도 구름 움직임
        for (const cl of clouds) { cl.x -= cl.speed; if (cl.x < -120) cl.x = W + 120; }
        drawMenu();
    } else if (state === 'gameover') {
        // 파티클만 계속 업데이트
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.vy += 0.18;
            p.life -= p.decay;
            if (p.life <= 0) particles.splice(i, 1);
        }
        render();
        drawGameOver();
    }

    requestAnimationFrame(loop);
}

// ── 시작 ──────────────────────────────────────────────
state  = 'menu';
clouds = buildClouds();
player = { x: PLAYER_X, y: H / 2, vy: 0, angle: 0, alive: true, wingPhase: 0 };
requestAnimationFrame(loop);
