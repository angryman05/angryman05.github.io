(() => {
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Storage can throw (private mode, blocked cookies), so every access is guarded
    const safe = (storage) => ({
        get(key) { try { return storage().getItem(key); } catch (e) { return null; } },
        set(key, value) { try { storage().setItem(key, value); } catch (e) { /* ignore */ } },
    });
    const local = safe(() => window.localStorage);
    const session = safe(() => window.sessionStorage);

    /* =========================================
       SOUND — tiny menu blips synthesized with Web Audio (no audio files)
       ========================================= */
    let soundOn = local.get('sound') === 'on';
    let ctx = null;

    // Only call from a user gesture (click / key), browsers block audio otherwise
    function unlockAudio() {
        if (!ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            ctx = new AudioCtx();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function tone(freq, delay, duration, { type = 'sine', gain = 0.05, slideTo = null } = {}) {
        const t0 = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
        amp.gain.setValueAtTime(0.0001, t0);
        amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        osc.connect(amp).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + duration + 0.05);
    }

    const sounds = {
        hover() { tone(1480, 0, 0.06, { type: 'triangle', gain: 0.022 }); },
        select() {
            tone(880, 0, 0.14, { gain: 0.045 });
            tone(1318.5, 0.06, 0.2, { gain: 0.04 });
        },
        back() {
            tone(783.99, 0, 0.12, { gain: 0.04 });
            tone(523.25, 0.07, 0.2, { gain: 0.04 });
        },
        open() {
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.055, 0.3, { gain: 0.035 }));
        },
        start() {
            [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.085, 0.6, { gain: 0.035 }));
            tone(261.63, 0, 1.0, { type: 'triangle', gain: 0.025 });
        },
    };

    // fromGesture: we're inside a click/keydown, so we may create/resume the audio context
    function play(name, fromGesture = true) {
        if (!soundOn || !sounds[name]) return;
        if (fromGesture) unlockAudio();
        if (!ctx || ctx.state !== 'running') {
            // Context still waking up: only queue sounds triggered by a gesture
            if (!fromGesture || !ctx) return;
        }
        sounds[name]();
    }

    // If sound was left on from a previous visit, wake audio up on the first interaction
    ['pointerdown', 'keydown'].forEach((type) => {
        document.addEventListener(type, () => { if (soundOn) unlockAudio(); }, true);
    });

    // Hover blips (mouse only), once per element
    const HOVERABLE = 'a, button, .project-card';
    let lastHovered = null;
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const el = e.target.closest(HOVERABLE);
        if (el && el !== lastHovered) play('hover', false);
        lastHovered = el;
    });

    // Keyboard focus gets the same blip
    let usingKeyboard = false;
    document.addEventListener('keydown', (e) => { if (e.key === 'Tab') usingKeyboard = true; });
    document.addEventListener('pointerdown', () => { usingKeyboard = false; });
    document.addEventListener('focusin', (e) => {
        if (usingKeyboard && e.target.closest && e.target.closest(HOVERABLE)) play('hover', false);
    });

    // Click sounds: data-sound="name" picks one, "none" opts out, other links/buttons get "select"
    document.addEventListener('click', (e) => {
        const tagged = e.target.closest('[data-sound]');
        if (tagged) {
            if (tagged.dataset.sound !== 'none') play(tagged.dataset.sound);
            return;
        }
        if (e.target.closest('a, button')) play('select');
    });

    // Sound toggle in the top bar
    const soundBtn = document.getElementById('sound-toggle');
    const soundLabel = soundBtn.querySelector('.sound-label');

    function setSound(on) {
        soundOn = on;
        local.set('sound', on ? 'on' : 'off');
        soundBtn.setAttribute('aria-pressed', String(on));
        soundLabel.textContent = on ? 'Sound on' : 'Sound off';
    }

    setSound(soundOn);
    soundBtn.addEventListener('click', () => {
        setSound(!soundOn);
        if (soundOn) play('select');
    });

    /* =========================================
       START SCREEN
       ========================================= */
    const intro = document.getElementById('intro');
    const behindIntro = [document.getElementById('page'), document.getElementById('menu-bar')];

    if (root.classList.contains('show-intro')) {
        behindIntro.forEach((el) => { el.inert = true; });
        intro.focus({ preventScroll: true });

        const enterSite = (withSound) => {
            if (intro.classList.contains('leaving')) return;
            if (withSound) setSound(true);
            session.set('introSeen', '1');
            play('start');

            behindIntro.forEach((el) => { el.inert = false; });
            intro.classList.add('leaving');
            // Let the page start rising in while the start screen fades out
            setTimeout(() => root.classList.remove('show-intro'), reduceMotion ? 0 : 250);
            setTimeout(() => intro.remove(), reduceMotion ? 0 : 650);
            document.removeEventListener('keydown', onKey);
        };

        const onKey = (e) => {
            // Leave browser shortcuts (F5, Ctrl+R, ...) and focus movement alone
            if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) return;
            if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
            // Enter/Space on the sound button is handled by its click event
            if (e.target.closest && e.target.closest('#intro-sound')) return;
            if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
            enterSite(false);
        };

        intro.addEventListener('click', (e) => enterSite(Boolean(e.target.closest('#intro-sound'))));
        document.addEventListener('keydown', onKey);
    } else {
        intro.remove();
    }

    /* =========================================
       PROJECT PREVIEW (channel-style)
       ========================================= */
    const dialog = document.getElementById('preview');
    const canPreview = typeof dialog.showModal === 'function';
    const pTitle = document.getElementById('preview-title');
    const pHost = document.getElementById('preview-host');
    const pTags = document.getElementById('preview-tags');
    const pDesc = document.getElementById('preview-desc');
    const pStart = document.getElementById('preview-start');
    const pBack = document.getElementById('preview-back');
    const pInner = dialog.querySelector('.preview-inner');

    let openerCard = null;
    let closing = false;

    function describeLink(href) {
        const url = new URL(href);
        const host = url.hostname.replace(/^www\./, '');
        if (host === 'github.com') {
            return host + url.pathname.split('/').slice(0, 3).join('/');
        }
        return host;
    }

    // Transform that makes the dialog sit exactly on top of the card
    function cardTransform(card) {
        const a = card.getBoundingClientRect();
        const b = dialog.getBoundingClientRect();
        const dx = (a.left + a.width / 2) - (b.left + b.width / 2);
        const dy = (a.top + a.height / 2) - (b.top + b.height / 2);
        return `translate(${dx}px, ${dy}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    }

    function openPreview(card) {
        openerCard = card;
        pTitle.textContent = card.querySelector('h4').textContent;
        pHost.textContent = describeLink(card.href);
        pTags.replaceChildren(...card.querySelector('.tech-stack').textContent.split(',').map((t) => {
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.textContent = t.trim();
            return tag;
        }));
        pDesc.textContent = card.querySelector('p:not(.tech-stack)').textContent.replace(/\s+/g, ' ').trim();
        pStart.href = card.href;

        dialog.showModal();
        root.classList.add('modal-open');
        pInner.scrollTop = 0;
        pStart.focus({ preventScroll: true });

        if (!reduceMotion) {
            dialog.animate(
                [{ transform: cardTransform(card), opacity: 0.5 }, { transform: 'none', opacity: 1 }],
                { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' }
            );
            pInner.animate(
                [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }],
                { duration: 420, easing: 'ease-out' }
            );
        }
    }

    function closePreview() {
        if (!dialog.open || closing) return;
        closing = true;

        const finish = () => {
            dialog.close();
            root.classList.remove('modal-open');
            closing = false;
            if (openerCard) openerCard.focus({ preventScroll: true });
        };

        if (reduceMotion || !openerCard) {
            finish();
            return;
        }

        pInner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
        const shrink = dialog.animate(
            [{ transform: 'none', opacity: 1 }, { transform: cardTransform(openerCard), opacity: 0 }],
            { duration: 320, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' }
        );
        shrink.finished.then(() => {
            finish();
            dialog.getAnimations({ subtree: true }).forEach((anim) => anim.cancel());
        });
    }

    document.querySelectorAll('.project-card').forEach((card) => {
        card.dataset.sound = canPreview ? 'open' : 'select';
        card.addEventListener('click', (e) => {
            // Ctrl/Cmd/Shift/middle-click still open the link directly
            if (!canPreview || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            openPreview(card);
        });
    });

    pBack.addEventListener('click', closePreview);

    pStart.addEventListener('click', () => {
        setTimeout(closePreview, 200);
    });

    // Esc key
    dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
        play('back');
        closePreview();
    });

    // Click on the blurred backdrop
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            play('back');
            closePreview();
        }
    });

    /* =========================================
       SHOW MORE PROJECTS (mobile)
       ========================================= */
    const toggleBtn = document.getElementById('toggle-projects-btn');
    const projectsGrid = document.querySelector('.projects-grid');

    toggleBtn.addEventListener('click', () => {
        projectsGrid.classList.toggle('show-all');
        toggleBtn.textContent = projectsGrid.classList.contains('show-all') ? 'Show less' : 'Show more';
    });

    /* =========================================
       MENU BAR CLOCK
       ========================================= */
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date');

    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        clockEl.innerHTML = `${h}<span class="colon">:</span>${m}`;
        dateEl.textContent = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric' });
    }

    updateClock();
    setInterval(updateClock, 10000);
})();
