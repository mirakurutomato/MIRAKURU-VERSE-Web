/**
 * MIRAKURU-VERSE Web Edition
 * MQTT + NaCl E2E暗号化
 * 第三者による監視が不可能なセキュアメタバース
 */

// ===== 定数 =====
const CONFIG = {
    colors: { bg: 0xe0f7fa, fog: 0xe0f7fa },
    avatarColors: [
        { main: 0x00bcd4 },
        { main: 0xff4081 },
        { main: 0x76ff03 },
        { main: 0xffab00 },
        { main: 0x651fff }
    ],
    movement: { speed: 0.22, rotSpeed: 0.035, verticalSpeed: 0.18 },
    camera: { distance: 8, height: 2.6, pitchMin: -0.6, pitchMax: 0.45, yawLimit: 1.0 },
    emotes: {
        wave: { icon: '👋', duration: 1200 },
        spin: { icon: '🌀', duration: 1000 },
        spark: { icon: '✨', duration: 900 },
        cheer: { icon: '🎵', duration: 1200 }
    },
    nameLimit: 12
};

const TAU = Math.PI * 2;
const randRange = (min, max) => min + Math.random() * (max - min);

// ===== セキュリティモジュール =====
class SecurityModule {
    /**
     * 暗号学的に安全なランダムID生成
     */
    static generateSecureId(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        const randomValues = new Uint32Array(length);
        crypto.getRandomValues(randomValues);
        for (let i = 0; i < length; i++) {
            result += chars[randomValues[i] % chars.length];
        }
        return result;
    }

    /**
     * ルームIDから暗号化キーを導出 (PBKDF2)
     */
    static async deriveKey(roomId) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(roomId),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: encoder.encode('MIRAKURU-VERSE-SALT-2025'),
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * AES-256-GCM暗号化
     */
    static async encrypt(key, data) {
        const encoder = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(JSON.stringify(data))
        );

        // IV + 暗号文を結合してBase64
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    /**
     * AES-256-GCM復号
     */
    static async decrypt(key, encryptedBase64) {
        try {
            const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const iv = combined.slice(0, 12);
            const ciphertext = combined.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                ciphertext
            );

            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            console.error('Decryption failed:', e);
            return null;
        }
    }
}

const MQTT_CONFIG = {
    brokerUrl: 'wss://broker.emqx.io:8084/mqtt',
    topicPrefix: 'mirakuruverse/private/',
    minSendInterval: 20,
};

const CryptoBox = {
    deriveKey(roomId) {
        const hash = nacl.hash(nacl.util.decodeUTF8(roomId));
        return hash.slice(0, 32);
    },
    makeNonce(senderId, counter) {
        const seed = `${senderId}:${counter}`;
        const hash = nacl.hash(nacl.util.decodeUTF8(seed));
        return hash.slice(0, 24);
    },
    encrypt(key, senderId, counter, payload) {
        const nonce = this.makeNonce(senderId, counter);
        const message = nacl.util.decodeUTF8(JSON.stringify(payload));
        const boxed = nacl.secretbox(message, nonce, key);
        return {
            v: 1,
            sender: senderId,
            counter,
            payload: nacl.util.encodeBase64(boxed),
        };
    },
    decrypt(key, envelope) {
        if (!envelope || envelope.v !== 1) return null;
        if (!envelope.sender || typeof envelope.counter !== 'number' || !envelope.payload) return null;
        const nonce = this.makeNonce(envelope.sender, envelope.counter);
        const boxed = nacl.util.decodeBase64(envelope.payload);
        const opened = nacl.secretbox.open(boxed, nonce, key);
        if (!opened) return null;
        try {
            return JSON.parse(nacl.util.encodeUTF8(opened));
        } catch (e) {
            return null;
        }
    },
};

// ===== URLパラメータ解析 =====
function parseInviteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    const expires = params.get('expires');
    const host = params.get('host');

    if (room) {
        const expiresAt = expires ? parseInt(expires, 10) : Date.now() + 86400000;
        if (expiresAt > Date.now()) {
            return { roomId: room, hostId: host || '', expiresAt, isHost: false };
        }
    }
    return null;
}

// ===== MagicSystem =====
class MagicSystem {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.type = options.type || 'snow';
        this.count = Math.max(20, Math.floor(options.count ?? 240));
        this.color = options.color || '#ffffff';
        this.speed = Math.max(0.1, options.speed ?? 0.8);
        this.size = Math.max(0.02, options.size ?? 0.12);
        this.area = { x: 90, y: 50, z: 90 };
        this.time = 0;
        this.points = null;
        this.positions = null;
        this.velocities = null;
        this.life = null;
        this.build();
    }

    applyConfig(config = {}) {
        const needsRebuild = config.type !== undefined && config.type !== this.type ||
            config.count !== undefined && config.count !== this.count;
        if (config.type) this.type = config.type;
        if (config.count) this.count = Math.max(20, config.count);
        if (config.color) this.color = config.color;
        if (config.speed) this.speed = Math.max(0.1, config.speed);
        if (config.size) this.size = Math.max(0.02, config.size);
        if (needsRebuild) this.build();
        else if (this.points) {
            this.points.material.color.set(this.color);
            this.points.material.size = this.size;
        }
        return this.getStatus();
    }

    getStatus() {
        return { type: this.type, count: this.count, color: this.color, speed: this.speed, size: this.size };
    }

    build() {
        if (this.points) this.scene.remove(this.points);
        const geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.count * 3);
        this.velocities = new Float32Array(this.count * 3);
        this.life = new Float32Array(this.count);
        for (let i = 0; i < this.count; i++) this.resetParticle(i, true);
        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        const material = new THREE.PointsMaterial({
            color: new THREE.Color(this.color),
            size: this.size,
            transparent: true,
            opacity: this.type === 'fireworks' ? 0.9 : 0.8,
            depthWrite: false
        });
        this.points = new THREE.Points(geometry, material);
        this.points.frustumCulled = false;
        this.scene.add(this.points);
    }

    resetParticle(i, fresh = false) {
        const idx = i * 3;
        const halfX = this.area.x / 2, halfY = this.area.y / 2, halfZ = this.area.z / 2;
        if (this.type === 'snow') {
            this.positions[idx] = randRange(-halfX, halfX);
            this.positions[idx + 1] = randRange(-halfY, halfY) + (fresh ? halfY : 0);
            this.positions[idx + 2] = randRange(-halfZ, halfZ);
            this.velocities[idx] = randRange(-0.3, 0.3);
            this.velocities[idx + 1] = randRange(0.6, 1.4);
            this.velocities[idx + 2] = randRange(-0.3, 0.3);
            this.life[i] = 1;
        } else if (this.type === 'spark') {
            const angle = randRange(0, TAU);
            const radius = randRange(0, Math.min(halfX, halfZ) * 0.5);
            this.positions[idx] = Math.cos(angle) * radius;
            this.positions[idx + 1] = randRange(-halfY * 0.4, halfY * 0.4);
            this.positions[idx + 2] = Math.sin(angle) * radius;
            this.velocities[idx] = randRange(-0.2, 0.2);
            this.velocities[idx + 1] = randRange(0.4, 1.0);
            this.velocities[idx + 2] = randRange(-0.2, 0.2);
            this.life[i] = 1;
        } else {
            const centerX = randRange(-halfX * 0.7, halfX * 0.7);
            const centerY = randRange(6, halfY + 10);
            const centerZ = randRange(-halfZ * 0.7, halfZ * 0.7);
            this.positions[idx] = centerX;
            this.positions[idx + 1] = centerY;
            this.positions[idx + 2] = centerZ;
            const theta = randRange(0, TAU), phi = randRange(0, Math.PI);
            const burstSpeed = randRange(1.0, 2.8);
            this.velocities[idx] = Math.cos(theta) * Math.sin(phi) * burstSpeed;
            this.velocities[idx + 1] = Math.cos(phi) * burstSpeed;
            this.velocities[idx + 2] = Math.sin(theta) * Math.sin(phi) * burstSpeed;
            this.life[i] = randRange(0.8, 1.8);
        }
    }

    update(delta) {
        if (!this.points) return;
        const halfY = this.area.y / 2;
        this.time += delta;
        if (this.type === 'snow') {
            for (let i = 0; i < this.count; i++) {
                const idx = i * 3;
                this.positions[idx + 1] -= this.velocities[idx + 1] * delta * this.speed;
                this.positions[idx] += this.velocities[idx] * delta * this.speed * 0.35;
                this.positions[idx + 2] += this.velocities[idx + 2] * delta * this.speed * 0.35;
                if (this.positions[idx + 1] < -halfY) this.resetParticle(i, true);
            }
        } else if (this.type === 'spark') {
            for (let i = 0; i < this.count; i++) {
                const idx = i * 3;
                this.positions[idx + 1] += this.velocities[idx + 1] * delta * this.speed;
                this.positions[idx] += Math.sin(this.time * 2.2 + i) * 0.01 * this.speed;
                this.positions[idx + 2] += Math.cos(this.time * 2.2 + i) * 0.01 * this.speed;
                if (this.positions[idx + 1] > halfY) this.resetParticle(i, true);
            }
        } else {
            for (let i = 0; i < this.count; i++) {
                const idx = i * 3;
                this.life[i] -= delta;
                if (this.life[i] <= 0) { this.resetParticle(i, true); continue; }
                this.velocities[idx + 1] -= 2.6 * delta;
                this.positions[idx] += this.velocities[idx] * delta * this.speed;
                this.positions[idx + 1] += this.velocities[idx + 1] * delta * this.speed;
                this.positions[idx + 2] += this.velocities[idx + 2] * delta * this.speed;
            }
        }
        this.points.geometry.attributes.position.needsUpdate = true;
    }
}

// ===== TreasureSystem =====
class TreasureSystem {
    constructor(world, options = {}) {
        this.world = world;
        this.radius = Math.max(6, options.radius ?? 28);
        this.position = new THREE.Vector3();
        this.lastDistance = null;
        this.reset();
    }

    reset() {
        const r = this.radius;
        this.position.set(randRange(-r, r), 0, randRange(-r, r));
        this.lastDistance = null;
    }

    distance() {
        if (!this.world.myAvatar) return null;
        return this.position.distanceTo(this.world.myAvatar.position);
    }

    hint(say = false) {
        const d = this.distance();
        if (d === null) return null;
        let msg = 'Warm...';
        if (this.lastDistance === null) msg = 'Find it...';
        else {
            const delta = this.lastDistance - d;
            if (delta > 0.2) msg = 'Hot!';
            else if (delta < -0.2) msg = 'Cold!';
        }
        this.lastDistance = d;
        if (say) this.world.systemSay(msg);
        return { message: msg, distance: d };
    }
}

// ===== SecureNetworkManager (MQTT + E2E) =====
class SecureNetworkManager {
    constructor(world) {
        this.world = world;
        this.client = null;
        this.roomId = null;
        this.myId = null;
        this.nickname = '';
        this.isHost = false;
        this.encryptionKey = null;
        this.messageCounter = 0;
        this.receivedCounters = new Map();
        this.replayWindow = 64;
        this.lastSent = 0;
        this.lastAnnounce = 0;
        this.isConnected = false;
    }

    /**
     * セキュアなルームIDを生成
     */
    generateRoomId() {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    /**
     * ルームを設定（ホストまたは参加者）
     */
    async setRoom(roomId, isHost = false, _hostPeerId = '') {
        this.roomId = roomId;
        this.isHost = isHost;
        this.myId = 'mv_' + SecurityModule.generateSecureId(16);
        this.encryptionKey = CryptoBox.deriveKey(roomId);
        this.messageCounter = 0;
        this.receivedCounters.clear();
    }

    getTopic() {
        return `${MQTT_CONFIG.topicPrefix}${this.roomId}`;
    }

    /**
     * MQTT接続を開始（タイムアウト付き）
     */
    async connect(nickname) {
        return new Promise((resolve) => {
            this.nickname = nickname;
            if (!this.myId) {
                this.myId = 'mv_' + SecurityModule.generateSecureId(16);
            }

            let resolved = false;
            const finish = (ok) => {
                if (resolved) return;
                resolved = true;
                if (!ok && this.client) {
                    this.client.end();
                    this.client = null;
                }
                resolve(ok);
            };

            const timeout = setTimeout(() => {
                console.warn('MQTT connection timeout');
                this.isConnected = false;
                finish(false);
            }, 15000);

            try {
                this.client = mqtt.connect(MQTT_CONFIG.brokerUrl, {
                    clientId: this.myId,
                    clean: true,
                    connectTimeout: 10000,
                    reconnectPeriod: 1000,
                });

                this.client.on('connect', () => {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    const topic = this.getTopic();
                    this.client.subscribe(topic, (err) => {
                        if (err) {
                            console.error('Subscribe error:', err);
                            this.isConnected = false;
                            finish(false);
                            return;
                        }
                        this.sendJoin();
                        finish(true);
                    });
                });

                this.client.on('message', (_topic, message) => {
                    this.handleMessage(message.toString());
                });

                this.client.on('error', (err) => {
                    console.error('MQTT error:', err);
                    this.isConnected = false;
                    finish(false);
                });

                this.client.on('close', () => {
                    this.isConnected = false;
                });
            } catch (e) {
                clearTimeout(timeout);
                console.error('MQTT initialization failed:', e);
                this.isConnected = false;
                finish(false);
            }
        });
    }

    handleMessage(rawMessage) {
        if (!this.encryptionKey) return;
        let envelope = null;
        try {
            envelope = JSON.parse(rawMessage);
        } catch (e) {
            console.error('Message parse error:', e);
            return;
        }
        const data = CryptoBox.decrypt(this.encryptionKey, envelope);
        if (!data || !data.id || data.id !== envelope.sender) return;
        if (this.isReplay(envelope.sender, envelope.counter)) return;
        if (data.id === this.myId) return;
        this.handlePayload(data);
    }

    handlePayload(data) {
        switch (data.type) {
            case 'join':
                this.world.addRemotePlayer(data.id, data.name, data.colorIdx);
                this.announcePresence();
                break;
            case 'leave':
                this.world.removeRemotePlayer(data.id);
                break;
            case 'move':
                this.world.addRemotePlayer(data.id, data.name, data.colorIdx);
                this.world.updateRemotePlayer(data.id, data);
                break;
            case 'chat':
                this.world.showRemoteBubble(data.id, data.text, 'normal');
                break;
            case 'reaction':
            case 'react':
                this.world.showRemoteBubble(data.id, data.symbol, 'symbol');
                break;
            case 'emote':
                this.world.playRemoteEmote(data.id, data.emote);
                break;
            case 'magic': {
                const config = data.config || {};
                const magicType = data.magicType || config.type || 'snow';
                this.world.magicSystem.applyConfig({
                    type: magicType,
                    count: data.count ?? config.count,
                    color: data.color ?? config.color,
                    speed: data.speed ?? config.speed,
                    size: data.size ?? config.size,
                });
                break;
            }
        }
    }

    announcePresence(force = false) {
        const now = Date.now();
        if (!force && now - this.lastAnnounce < 1000) return;
        this.lastAnnounce = now;
        this.sendJoin();
    }

    isReplay(sender, counter) {
        const state = this.receivedCounters.get(sender);
        if (!state) {
            this.receivedCounters.set(sender, { last: counter, seen: new Set([counter]) });
            return false;
        }
        if (state.seen.has(counter)) return true;
        if (counter < state.last - this.replayWindow) return true;
        if (counter > state.last) {
            state.last = counter;
        }
        state.seen.add(counter);
        const threshold = state.last - this.replayWindow;
        for (const value of state.seen) {
            if (value < threshold) {
                state.seen.delete(value);
            }
        }
        return false;
    }

    send(data) {
        if (!this.client || !this.roomId || !this.encryptionKey || !this.isConnected) return;
        const payload = {
            ...data,
            id: this.myId,
            name: this.nickname,
        };
        this.messageCounter += 1;
        const envelope = CryptoBox.encrypt(this.encryptionKey, this.myId, this.messageCounter, payload);
        this.client.publish(this.getTopic(), JSON.stringify(envelope));
    }

    sendJoin() {
        this.send({ type: 'join', colorIdx: this.world.myColorIdx });
    }

    sendLeave() {
        this.send({ type: 'leave' });
    }

    /**
     * 全体ブロードキャスト
     */
    async broadcast(data) {
        this.send(data);
    }

    /**
     * 移動情報をブロードキャスト
     */
    async broadcastMove() {
        const now = Date.now();
        if (now - this.lastSent < MQTT_CONFIG.minSendInterval) return;
        this.lastSent = now;

        const p = this.world.myAvatar.position;
        this.send({
            type: 'move',
            x: p.x, y: p.y, z: p.z,
            ry: this.world.myAvatar.rotation.y,
            colorIdx: this.world.myColorIdx,
        });
    }

    /**
     * 切断
     */
    disconnect() {
        this.sendLeave();

        if (this.client) {
            this.client.end();
            this.client = null;
        }
        this.isConnected = false;
        this.encryptionKey = null;
        this.receivedCounters.clear();
        this.nickname = '';
    }

    /**
     * 招待URL生成
     */
    generateInviteUrl() {
        const baseUrl = window.location.href.split('?')[0];
        const expires = Date.now() + 24 * 60 * 60 * 1000; // 24時間
        const hostId = this.myId || '';
        return `${baseUrl}?room=${this.roomId}&expires=${expires}&host=${hostId}`;
    }
}

// ===== MirakuruVerse =====
class MirakuruVerse {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.keys = {};
        this.remotePlayers = {};
        this.myName = '';
        this.myColorIdx = Math.floor(Math.random() * CONFIG.avatarColors.length);
        this.view = { yaw: 0, pitch: 0, isDragging: false, lastX: 0, lastY: 0 };
        this.move = { forward: 0, turn: 0, vertical: 0 };
        this.bubbles = [];
        this.inviteInfo = parseInviteFromUrl();
        this.isHost = false;
        this.appBridgeAttached = false;
        this.appMode = new URLSearchParams(window.location.search).get('app') === '1';
        this.isEmbedded = new URLSearchParams(window.location.search).get('app') === '1';
        if (this.isEmbedded) {
            document.body.classList.add('app-embed');
        }

        // アプリモード: ログイン画面をスキップ（enterRoomメッセージを待機）
        this.appModeAutoEntered = false;

        this.ui = {
            loginScreen: document.getElementById('login-screen'),
            metaverseScreen: document.getElementById('metaverse-screen'),
            nicknameInput: document.getElementById('nickname-input'),
            connectButton: document.getElementById('btn-connect'),
            nicknameDisplay: document.getElementById('nickname-display'),
            roomBadge: document.getElementById('room-badge-header'),
            roomInfo: document.getElementById('room-info'),
            roomIdDisplay: document.getElementById('room-id-display'),
            chatInput: document.getElementById('chat-input'),
            chatSend: document.getElementById('chat-send'),
            pythonBtn: document.getElementById('btn-python'),
            pythonPanel: document.getElementById('python-panel'),
            pythonClose: document.getElementById('python-close'),
            pythonCode: document.getElementById('python-code'),
            pythonRun: document.getElementById('python-run'),
            pythonHelp: document.getElementById('python-help'),
            pythonClear: document.getElementById('python-clear'),
            pythonOutput: document.getElementById('python-output'),
            exitBtn: document.getElementById('btn-exit'),
            bubbleOverlay: document.getElementById('bubble-overlay')
        };

        this.network = new SecureNetworkManager(this);
        this.initThree();
        this.createEnvironment();
        this.clock = new THREE.Clock();
        this.magicSystem = new MagicSystem(this.scene);
        this.treasureSystem = new TreasureSystem(this);
        this.setupLogin();
        this.updateAppModeUI();
        this.setupInputs();
        this.setupViewControls();
        this.setupTouchControls();
        this.setupChat();
        this.setupPython();
        this.setupHint();
        this.setupAppBridge();
        this.animate();

        // 招待情報表示
        this.updateInviteInfoUI();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(CONFIG.colors.bg);
        this.scene.fog = new THREE.FogExp2(CONFIG.colors.fog, 0.012);

        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const dirLight = new THREE.DirectionalLight(0xe0f7fa, 1.0);
        dirLight.position.set(50, 100, 50);
        this.scene.add(dirLight);

        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    createEnvironment() {
        // Floor ring
        const ringGeo = new THREE.TorusGeometry(40, 0.2, 16, 100);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x0288d1, transparent: true, opacity: 0.2 });
        const floorRing = new THREE.Mesh(ringGeo, ringMat);
        floorRing.rotation.x = Math.PI / 2;
        floorRing.position.y = -10;
        this.scene.add(floorRing);

        // Grid
        const grid = new THREE.GridHelper(200, 60, 0x00bcd4, 0x006064);
        grid.material.opacity = 0.18;
        grid.material.transparent = true;
        grid.position.y = -0.5;
        this.scene.add(grid);

        // Floating boxes
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const boxMat = new THREE.MeshPhysicalMaterial({ color: 0x00bcd4, transparent: true, opacity: 0.5 });
        for (let i = 0; i < 100; i++) {
            const mesh = new THREE.Mesh(boxGeo, boxMat);
            mesh.position.set(
                randRange(-50, 50),
                randRange(5, 30),
                randRange(-50, 50)
            );
            this.scene.add(mesh);
        }
    }

    createAvatarMesh(colorIdx) {
        const group = new THREE.Group();
        const visual = new THREE.Group();
        group.add(visual);
        group.userData = { visual };

        const color = CONFIG.avatarColors[colorIdx % CONFIG.avatarColors.length].main;

        // Body
        const body = new THREE.Mesh(
            new THREE.SphereGeometry(0.8, 32, 32),
            new THREE.MeshToonMaterial({ color: 0xffffff })
        );
        visual.add(body);

        // Eyes
        const eyeMat = new THREE.MeshBasicMaterial({ color });
        const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), eyeMat);
        leftEye.position.set(-0.25, 0.2, 0.65);
        const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), eyeMat);
        rightEye.position.set(0.25, 0.2, 0.65);
        visual.add(leftEye, rightEye);

        // Ears
        const earGeo = new THREE.ConeGeometry(0.15, 1.2, 32);
        const earMat = new THREE.MeshToonMaterial({ color });
        const leftEar = new THREE.Mesh(earGeo, earMat);
        leftEar.position.set(-0.5, 1.0, 0);
        leftEar.rotation.z = 0.2;
        const rightEar = new THREE.Mesh(earGeo, earMat);
        rightEar.position.set(0.5, 1.0, 0);
        rightEar.rotation.z = -0.2;
        visual.add(leftEar, rightEar);

        // Ring
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(1.4, 0.03, 16, 64),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 })
        );
        ring.rotation.x = Math.PI / 1.8;
        visual.add(ring);

        return group;
    }

    async setupLogin() {
        if (this.appMode) {
            if (this.ui.nicknameInput) {
                this.ui.nicknameInput.disabled = true;
                this.ui.nicknameInput.placeholder = 'APP CONTROLLED';
            }
            if (this.ui.connectButton) {
                this.ui.connectButton.disabled = true;
                this.ui.connectButton.textContent = 'APP CONTROLLED';
            }
            return;
        }

        // ニックネーム入力時にボタン有効化
        this.ui.nicknameInput.addEventListener('input', () => {
            const name = this.ui.nicknameInput.value.replace(/\s+/g, '');
            this.ui.connectButton.disabled = !name;
        });

        // Enterキーでも接続
        this.ui.nicknameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const name = this.ui.nicknameInput.value.replace(/\s+/g, '');
                if (name) this.ui.connectButton.click();
            }
        });

        this.ui.connectButton.addEventListener('click', async () => {
            const name = this.ui.nicknameInput.value.replace(/\s+/g, '').slice(0, CONFIG.nameLimit);
            if (!name) {
                alert('ニックネームを入力してください');
                return;
            }

            await this.connectToRoom({ name });
        });

        this.ui.exitBtn.addEventListener('click', () => {
            this.network.disconnect();
            location.reload();
        });
    }

    updateInviteInfoUI() {
        if (!this.ui.roomInfo || !this.ui.roomIdDisplay) return;
        if (!this.inviteInfo) {
            this.ui.roomInfo.classList.add('hidden');
            return;
        }

        this.ui.roomInfo.classList.remove('hidden');
        const shortId = this.inviteInfo.roomId.length > 20
            ? this.inviteInfo.roomId.slice(0, 10) + '...' + this.inviteInfo.roomId.slice(-6)
            : this.inviteInfo.roomId;
        this.ui.roomIdDisplay.textContent = `Room: ${shortId}`;
    }

    updateAppModeUI() {
        if (!this.appMode || !this.ui.loginScreen) return;
        this.ui.loginScreen.classList.add('app-mode');
    }

    resetRoomState() {
        if (this.myAvatar) {
            this.scene.remove(this.myAvatar);
            this.myAvatar = null;
        }

        Object.values(this.remotePlayers).forEach((player) => {
            if (player && player.mesh) {
                this.scene.remove(player.mesh);
            }
        });
        this.remotePlayers = {};

        this.bubbles.forEach((bubble) => {
            if (bubble && bubble.bubble) {
                bubble.bubble.remove();
            }
        });
        this.bubbles = [];
    }

    postToApp(type, payload = {}) {
        if (!window.ReactNativeWebView || typeof window.ReactNativeWebView.postMessage !== 'function') {
            return;
        }
        window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
    }

    notifyJoined() {
        const roomId = this.network.roomId || (this.inviteInfo ? this.inviteInfo.roomId : null);
        if (!roomId) return;
        const payload = {
            roomId,
            hostId: this.network.myId || (this.inviteInfo ? this.inviteInfo.hostId : ''),
            isHost: this.isHost,
        };
        payload.expiresAt = this.inviteInfo?.expiresAt || Date.now() + 24 * 60 * 60 * 1000;
        if (this.isHost) {
            payload.inviteUrl = this.network.generateInviteUrl();
        }
        this.postToApp('joined', payload);
    }

    async connectToRoom(options = {}) {
        const rawName = options.name || '';
        const name = rawName.replace(/\s+/g, '').slice(0, CONFIG.nameLimit);
        if (!name) {
            if (!options.silent) {
                alert('ニックネームを入力してください');
            }
            this.postToApp('error', { code: 'INVALID_NAME', message: 'ニックネームを入力してください' });
            return false;
        }

        const explicitRoomId = options.roomId || null;
        const explicitHostId = options.hostId || '';
        const hostMode = Boolean(options.isHost);
        const expiresAt = options.expiresAt || (this.inviteInfo ? this.inviteInfo.expiresAt : Date.now() + 86400000);
        const force = Boolean(options.force);

        if (this.network.isConnected) {
            if (force) {
                this.network.disconnect();
                this.resetRoomState();
            } else {
                this.postToApp('error', { code: 'ALREADY_CONNECTED', message: 'すでに接続済みです' });
                return false;
            }
        }

        this.myName = name;
        if (this.ui.connectButton) {
            this.ui.connectButton.disabled = true;
            this.ui.connectButton.textContent = '接続中...';
        }

        try {

            if (explicitRoomId) {
                this.inviteInfo = {
                    roomId: explicitRoomId,
                    hostId: explicitHostId,
                    expiresAt,
                    isHost: hostMode,
                };
                this.updateInviteInfoUI();
                await this.network.setRoom(explicitRoomId, hostMode, explicitHostId);
                if (this.ui.roomBadge) {
                    this.ui.roomBadge.textContent = hostMode ? 'HOST' : 'INVITED ROOM';
                    this.ui.roomBadge.classList.add('active');
                }
                this.isHost = hostMode;
            } else if (this.inviteInfo) {
                await this.network.setRoom(this.inviteInfo.roomId, false, this.inviteInfo.hostId);
                if (this.ui.roomBadge) {
                    this.ui.roomBadge.textContent = 'INVITED ROOM';
                    this.ui.roomBadge.classList.add('active');
                }
                this.isHost = false;
            } else {
                const roomId = this.network.generateRoomId();
                await this.network.setRoom(roomId, true);
                if (this.ui.roomBadge) {
                    this.ui.roomBadge.textContent = 'HOST';
                    this.ui.roomBadge.classList.add('active');
                }
                this.isHost = true;
            }

            const connected = await this.network.connect(this.myName);
            if (!connected) {
                throw new Error('MQTT connection failed');
            }
            this.network.announcePresence(true);
            setTimeout(() => this.network.announcePresence(true), 1500);
            setTimeout(() => this.network.announcePresence(true), 3000);
            if (this.isHost) {
                console.log('Invite URL:', this.network.generateInviteUrl());
            }

            // アバター作成
            this.myAvatar = this.createAvatarMesh(this.myColorIdx);
            this.myAvatar.position.set(randRange(-5, 5), 0, randRange(-5, 5));
            this.scene.add(this.myAvatar);

            // 画面切り替え
            if (this.ui.loginScreen) {
                this.ui.loginScreen.classList.remove('active');
            }
            if (this.ui.metaverseScreen) {
                this.ui.metaverseScreen.classList.add('active');
            }
            if (this.ui.nicknameDisplay) {
                this.ui.nicknameDisplay.textContent = this.myName;
            }

            this.notifyJoined();
            return true;
        } catch (e) {
            console.error('Connection failed:', e);
            if (this.ui.connectButton) {
                this.ui.connectButton.disabled = false;
                this.ui.connectButton.textContent = 'ENTER WORLD';
            }
            if (!options.silent) {
                alert('接続に失敗しました');
            }
            this.postToApp('error', { code: 'CONNECT_FAILED', message: e && e.message ? e.message : '接続に失敗しました' });
            return false;
        }
    }

    async enterFromApp(payload = {}) {
        const nickname = payload.nickname || payload.name || '';
        if (this.ui.nicknameInput && nickname) {
            this.ui.nicknameInput.value = nickname;
        }
        await this.connectToRoom({
            name: nickname,
            roomId: payload.roomId || null,
            hostId: payload.hostId || '',
            isHost: Boolean(payload.isHost),
            expiresAt: payload.expiresAt,
            force: Boolean(payload.force),
            silent: true,
        });
    }

    leaveFromApp() {
        this.network.disconnect();
        this.postToApp('left', {});
        location.reload();
    }

    handleAppMessage(raw) {
        if (!raw) return;
        let message = raw;
        if (typeof raw === 'string') {
            try {
                message = JSON.parse(raw);
            } catch (e) {
                return;
            }
        }
        if (!message || typeof message.type !== 'string') return;

        const payload = message.payload || {};
        switch (message.type) {
            case 'enterRoom':
                this.enterFromApp(payload);
                break;
            case 'leave':
                this.leaveFromApp();
                break;
            case 'setNickname': {
                const name = (payload.nickname || '').replace(/\s+/g, '').slice(0, CONFIG.nameLimit);
                if (this.ui.nicknameInput && name) {
                    this.ui.nicknameInput.value = name;
                }
                this.postToApp('nicknameSet', { nickname: name });
                break;
            }
            case 'python': {
                const requestId = payload.requestId;
                const code = String(payload.code ?? '');
                if (!code.trim()) {
                    this.postToApp('pythonResult', {
                        requestId,
                        output: ['Error: Empty code'],
                        error: 'Empty code',
                    });
                    break;
                }
                this.executePythonCode(code)
                    .then((output) => {
                        this.postToApp('pythonResult', { requestId, output });
                    })
                    .catch((err) => {
                        const message = err && err.message ? err.message : String(err);
                        this.postToApp('pythonResult', {
                            requestId,
                            output: [`Error: ${message}`],
                            error: message,
                        });
                    });
                break;
            }
            case 'ping':
                this.postToApp('pong', { ts: Date.now() });
                break;
            default:
                break;
        }
    }

    setupAppBridge() {
        if (this.appBridgeAttached) return;
        this.appBridgeAttached = true;

        const handler = (event) => {
            this.handleAppMessage(event.data);
        };

        window.addEventListener('message', handler);
        document.addEventListener('message', handler);

        // アプリモード: ログイン画面をスキップしてメタバース画面を表示
        if (this.appMode && !this.appModeAutoEntered) {
            this.appModeAutoEntered = true;
            this.ui.loginScreen.classList.remove('active');
            this.ui.metaverseScreen.classList.add('active');
        }

        this.postToApp('ready', {
            version: 1,
            hasInvite: Boolean(this.inviteInfo),
        });
    }

    setupInputs() {
        const applyKey = (e, isDown) => {
            const key = e.key.toLowerCase();
            if (e.code === 'Space' || key === ' ') {
                this.keys.space = isDown;
                return;
            }
            if (key === 'shift') {
                this.keys.shift = isDown;
                return;
            }
            this.keys[key] = isDown;
        };

        document.addEventListener('keydown', (e) => {
            applyKey(e, true);
        });
        document.addEventListener('keyup', (e) => {
            applyKey(e, false);
        });
    }

    setupViewControls() {
        const canvas = this.renderer.domElement;

        canvas.addEventListener('pointerdown', (e) => {
            if (e.target !== canvas) return;
            this.view.isDragging = true;
            this.view.lastX = e.clientX;
            this.view.lastY = e.clientY;
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!this.view.isDragging) return;
            const dx = e.clientX - this.view.lastX;
            const dy = e.clientY - this.view.lastY;
            this.view.yaw = Math.max(-CONFIG.camera.yawLimit, Math.min(CONFIG.camera.yawLimit, this.view.yaw - dx * 0.005));
            this.view.pitch = Math.max(CONFIG.camera.pitchMin, Math.min(CONFIG.camera.pitchMax, this.view.pitch - dy * 0.005));
            this.view.lastX = e.clientX;
            this.view.lastY = e.clientY;
        });

        canvas.addEventListener('pointerup', () => { this.view.isDragging = false; });
        canvas.addEventListener('pointercancel', () => { this.view.isDragging = false; });
    }

    setupTouchControls() {
        document.querySelectorAll('.dpad-btn, .vertical-btn').forEach(btn => {
            const key = btn.dataset.key;
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this.keys[key] = true;
            });
            btn.addEventListener('touchend', () => { this.keys[key] = false; });
            btn.addEventListener('touchcancel', () => { this.keys[key] = false; });
            btn.addEventListener('mousedown', () => { this.keys[key] = true; });
            btn.addEventListener('mouseup', () => { this.keys[key] = false; });
            btn.addEventListener('mouseleave', () => { this.keys[key] = false; });
        });
    }

    setupChat() {
        if (!this.ui.chatInput || !this.ui.chatSend) return;
        const sendChat = async () => {
            const text = this.ui.chatInput.value.trim();
            if (!text) return;
            this.ui.chatInput.value = '';
            await this.network.broadcast({ type: 'chat', text });
            this.showBubble(this.myAvatar, text, 'normal');
        };

        this.ui.chatSend.addEventListener('click', sendChat);
        this.ui.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChat();
        });

        // Reactions
        document.querySelectorAll('.reaction-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const symbol = btn.dataset.reaction;
                await this.network.broadcast({ type: 'reaction', symbol });
                this.showBubble(this.myAvatar, symbol, 'symbol');
            });
        });

        // Emotes
        document.querySelectorAll('.emote-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const emote = btn.dataset.emote;
                await this.network.broadcast({ type: 'emote', emote });
                this.playEmote(this.myAvatar, emote);
            });
        });
    }

    setupPython() {
        if (!this.ui.pythonPanel || !this.ui.pythonBtn || !this.ui.pythonRun || !this.ui.pythonCode) {
            return;
        }
        this.ui.pythonBtn.addEventListener('click', () => {
            this.ui.pythonPanel.classList.toggle('hidden');
        });
        if (this.ui.pythonClose) {
            this.ui.pythonClose.addEventListener('click', () => {
                this.ui.pythonPanel.classList.add('hidden');
            });
        }
        if (this.ui.pythonClear && this.ui.pythonOutput) {
            this.ui.pythonClear.addEventListener('click', () => {
                this.ui.pythonOutput.textContent = '';
            });
        }

        this.ui.pythonRun.addEventListener('click', () => {
            const code = this.ui.pythonCode.value;
            this.executePythonCode(code);
        });

        if (this.ui.pythonHelp) {
            this.ui.pythonHelp.addEventListener('click', () => {
                this.executePythonCode('help()');
            });
        }
    }

    setupHint() {
        const hint = document.getElementById('hint');
        if (!hint) return;
        let hidden = false;

        const hide = () => {
            if (hidden) return;
            hidden = true;
            hint.classList.add('is-hidden');
            document.removeEventListener('keydown', hide);
            document.removeEventListener('pointerdown', hide);
            document.removeEventListener('touchstart', hide);
        };

        setTimeout(hide, 5000);
        document.addEventListener('keydown', hide);
        document.addEventListener('pointerdown', hide);
        document.addEventListener('touchstart', hide);
    }

    async executePythonCode(code) {
        const lines = code.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        const output = [];

        for (const line of lines) {
            try {
                const result = await this.executeLine(line.trim());
                if (result) output.push(result);
            } catch (e) {
                output.push(`Error: ${e.message}`);
            }
        }

        if (this.ui.pythonOutput) {
            this.ui.pythonOutput.textContent = output.join('\n');
        }
        return output;
    }

    async executeLine(line) {
        const match = line.match(/^(\w+)\((.*)\)$/);
        if (!match) return `Invalid: ${line}`;

        const func = match[1];
        const argsStr = match[2];
        const args = this.parseArgs(argsStr);

        switch (func) {
            case 'say':
                const text = args[0] || '';
                await this.network.broadcast({ type: 'chat', text });
                this.showBubble(this.myAvatar, text, 'normal');
                return `sent: "${text}"`;
            case 'react':
                const symbol = args[0] || '👍';
                await this.network.broadcast({ type: 'reaction', symbol });
                this.showBubble(this.myAvatar, symbol, 'symbol');
                return `reacted: ${symbol}`;
            case 'emote':
                const emote = args[0] || 'wave';
                await this.network.broadcast({ type: 'emote', emote });
                this.playEmote(this.myAvatar, emote);
                return `emoted: ${emote}`;
            case 'magic':
                const config = { type: args[0] || 'snow' };
                if (args[1]) config.count = parseInt(args[1]);
                if (args[2]) config.color = args[2];
                if (args[3]) config.speed = parseFloat(args[3]);
                this.magicSystem.applyConfig(config);
                const magicPayload = { type: 'magic', magicType: config.type };
                if (config.count) magicPayload.count = config.count;
                if (config.color) magicPayload.color = config.color;
                if (config.speed) magicPayload.speed = config.speed;
                if (config.size) magicPayload.size = config.size;
                await this.network.broadcast(magicPayload);
                return `magic: ${config.type}`;
            case 'treasure_hint':
                const hint = this.treasureSystem.hint(true);
                return hint ? `hint: ${hint.message} (distance: ${hint.distance.toFixed(1)})` : 'not ready';
            case 'treasure_reset':
                this.treasureSystem.reset();
                return 'treasure reset';
            case 'invite':
                const url = this.network.generateInviteUrl();
                await navigator.clipboard.writeText(url);
                return `Invite URL copied!\n${url}`;
            case 'status':
                const p = this.myAvatar?.position;
                return p ? `position: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : 'not ready';
            case 'help':
                return [
                    'say("text")      # チャット',
                    'react("👍")      # リアクション',
                    'emote("wave")    # エモート',
                    'magic("snow")    # 魔法エフェクト',
                    'treasure_hint()  # 宝探しヒント',
                    'treasure_reset() # 宝箱リセット',
                    'invite()         # 招待URLをコピー',
                    'status()         # 位置情報'
                ].join('\n');
            default:
                return `Unknown: ${func}`;
        }
    }

    parseArgs(argsStr) {
        if (!argsStr.trim()) return [];
        const args = [];
        let current = '', inString = false, stringChar = '';
        for (const char of argsStr) {
            if (!inString && (char === '"' || char === "'")) {
                inString = true;
                stringChar = char;
            } else if (inString && char === stringChar) {
                inString = false;
            } else if (!inString && char === ',') {
                args.push(this.parseValue(current.trim()));
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) args.push(this.parseValue(current.trim()));
        return args;
    }

    parseValue(v) {
        if (v.includes('=')) v = v.split('=')[1].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            return v.slice(1, -1);
        const n = parseFloat(v);
        if (!isNaN(n)) return n;
        return v;
    }

    // Remote players
    addRemotePlayer(key, name, colorIdx) {
        if (this.remotePlayers[key]) return;
        const mesh = this.createAvatarMesh(colorIdx);
        mesh.position.set(randRange(-5, 5), 0, randRange(-5, 5));
        this.scene.add(mesh);
        this.remotePlayers[key] = { mesh, name };
        this.systemSay(`${name} が参加しました`);
    }

    removeRemotePlayer(key) {
        const player = this.remotePlayers[key];
        if (player) {
            this.scene.remove(player.mesh);
            this.systemSay(`${player.name} が退出しました`);
            delete this.remotePlayers[key];
        }
    }

    updateRemotePlayer(key, data) {
        const player = this.remotePlayers[key];
        if (player) {
            player.mesh.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.2);
            player.mesh.rotation.y = data.ry;
        }
    }

    showRemoteBubble(key, text, type) {
        const player = this.remotePlayers[key];
        if (player) this.showBubble(player.mesh, text, type);
    }

    playRemoteEmote(key, emote) {
        const player = this.remotePlayers[key];
        if (player) this.playEmote(player.mesh, emote);
    }

    // Bubbles
    showBubble(mesh, text, type) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble' + (type === 'symbol' ? ' symbol' : '');
        bubble.textContent = text;
        this.ui.bubbleOverlay.appendChild(bubble);

        const updatePosition = () => {
            if (!mesh) return;
            const pos = mesh.position.clone();
            pos.y += 2.2;
            const screenPos = pos.project(this.camera);
            const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
            bubble.style.left = x + 'px';
            bubble.style.top = y + 'px';
        };

        const data = { bubble, mesh, updatePosition };
        this.bubbles.push(data);

        setTimeout(() => {
            bubble.style.animation = 'bubbleOut 0.5s forwards';
            setTimeout(() => {
                bubble.remove();
                const idx = this.bubbles.indexOf(data);
                if (idx >= 0) this.bubbles.splice(idx, 1);
            }, 500);
        }, 4000);
    }

    playEmote(mesh, emote) {
        const config = CONFIG.emotes[emote];
        if (!config) return;
        this.showBubble(mesh, config.icon, 'symbol');
    }

    systemSay(text) {
        this.showBubble(this.myAvatar, text, 'normal');
    }

    // Animation
    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        if (this.myAvatar) {
            // Movement
            const speed = CONFIG.movement.speed;
            const rotSpeed = CONFIG.movement.rotSpeed;
            const vSpeed = CONFIG.movement.verticalSpeed;
            const frameScale = Math.min(delta * 60, 2.5);

            let targetForward = 0;
            let targetTurn = 0;
            let targetVertical = 0;

            if (this.keys['w'] || this.keys['arrowup']) targetForward += 1;
            if (this.keys['s'] || this.keys['arrowdown']) targetForward -= 1;
            if (this.keys['a'] || this.keys['arrowleft']) targetTurn += 1;
            if (this.keys['d'] || this.keys['arrowright']) targetTurn -= 1;
            if (this.keys['q'] || this.keys['space']) targetVertical += 1;
            if (this.keys['e'] || this.keys['shift']) targetVertical -= 1;

            const smooth = 0.32;
            this.move.forward += (targetForward - this.move.forward) * smooth;
            this.move.turn += (targetTurn - this.move.turn) * smooth;
            this.move.vertical += (targetVertical - this.move.vertical) * smooth;

            if (Math.abs(this.move.turn) > 0.001) {
                this.myAvatar.rotation.y += this.move.turn * rotSpeed * frameScale;
            }

            if (Math.abs(this.move.forward) > 0.001) {
                const yaw = this.myAvatar.rotation.y;
                this.myAvatar.position.x += Math.sin(yaw) * this.move.forward * speed * frameScale;
                this.myAvatar.position.z += Math.cos(yaw) * this.move.forward * speed * frameScale;
            }
            if (Math.abs(this.move.vertical) > 0.001) {
                this.myAvatar.position.y += this.move.vertical * vSpeed * frameScale;
            }

            if (Math.abs(this.move.forward) > 0.01 || Math.abs(this.move.vertical) > 0.01 || Math.abs(this.move.turn) > 0.01) {
                this.network.broadcastMove();
            }

            // Camera
            const target = this.myAvatar.position.clone();
            target.y += 1.6;
            const yaw = this.myAvatar.rotation.y + Math.PI + this.view.yaw;
            const pitch = this.view.pitch;
            const horizontal = Math.cos(pitch) * CONFIG.camera.distance;
            const offset = new THREE.Vector3(
                Math.sin(yaw) * horizontal,
                CONFIG.camera.height + Math.sin(pitch) * CONFIG.camera.distance,
                Math.cos(yaw) * horizontal
            );
            const desired = this.myAvatar.position.clone().add(offset);
            this.camera.position.lerp(desired, 0.1);
            this.camera.lookAt(target);
        }

        // Update systems
        this.magicSystem.update(delta);

        // Update bubbles
        for (const b of this.bubbles) {
            b.updatePosition();
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', () => {
    // ライブラリの存在確認
    if (typeof THREE === 'undefined') {
        console.error('Three.js not loaded - cannot initialize MirakuruVerse');
        return;
    }
    if (typeof mqtt === 'undefined') {
        console.error('MQTT not loaded - cannot initialize MirakuruVerse');
        return;
    }
    if (typeof nacl === 'undefined' || !nacl.util) {
        console.error('NaCl not loaded - cannot initialize MirakuruVerse');
        return;
    }

    window.mirakuruVerse = new MirakuruVerse();
});
