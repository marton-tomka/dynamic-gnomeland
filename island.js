import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {IslandMedia} from './media.js';
import {IslandSearch} from './search.js';

const vertical = properties => new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL, ...properties,
});
const icon = (name, size = 18) => new St.Icon({icon_name: name, icon_size: size});
const label = (text, styleClass) => new St.Label({
    text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER,
});

export class IslandSurface {
    constructor(dateMenu) {
        const source = dateMenu?._messageList?._messageView?._mediaSource;
        if (!source)
            throw new Error('Dyno requires the native GNOME 50 media source. Another extension has replaced it.');
        this.dateMenu = dateMenu;
        this.isOpen = false;
        this.isPreview = false;
        this.page = 'home';
        this._epoch = 0;
        this._grab = null;
        this._borrowed = null;
        this._actions = new Map();
        this._rows = new Map();
        this._anchor = null;
        this._disposed = false;
        this.actor = new St.Widget({
            name: 'dyno-surface', style_class: 'dyno-shell',
            reactive: true, visible: false,
        });
        this.background = new St.Widget({style_class: 'dyno-background'});
        this.contentClip = new Clutter.Actor({clip_to_allocation: true});
        this.contentClip.add_constraint(new Clutter.BindConstraint({source: this.background,
            coordinate: Clutter.BindCoordinate.ALL}));
        this.contentPosition = new Clutter.Actor();
        this.content = vertical({style_class: 'dyno-content'});
        this.actor.add_child(this.background);
        this.actor.add_child(this.contentClip);
        this.contentClip.add_child(this.contentPosition);
        this.contentPosition.add_child(this.content);
        Main.layoutManager.addTopChrome(this.actor, {affectsStruts: false, trackFullscreen: false});
        global.focus_manager.add_group(this.actor);
        this.actor.connect('captured-event', (_actor, event) => this._captured(event));
        this.search = new IslandSearch(() => this._renderResults());
        this._build();
        this.media = new IslandMedia(source, () => {
            if (this.media) {
                if (this.isOpen)
                    this._refreshMedia();
                this.onMediaChanged?.();
            }
        });
        this._refreshMedia();
    }

    _button(name, accessibleName, action, styleClass = '') {
        const button = new St.Button({
            style_class: `dyno-button ${styleClass}`, child: icon(name),
            accessible_name: accessibleName,
            can_focus: true, reactive: true, track_hover: true,
        });
        const activate = () => {
            this.onEvent?.();
            action();
        };
        button.connect('clicked', activate);
        this._actions.set(button, activate);
        return button;
    }

    _build() {
        this.header = new St.BoxLayout({style_class: 'dyno-header'});
        this.headerLeft = new St.BoxLayout({style_class: 'dyno-header-wing dyno-header-left'});
        this.headerRight = new St.Bin({style_class: 'dyno-header-wing'});
        this.heading = label('', 'dyno-clock');
        this.heading.x_align = Clutter.ActorAlign.CENTER;
        const clockPlaceholder = new St.Widget();
        clockPlaceholder.add_constraint(new Clutter.BindConstraint({source: this.heading,
            coordinate: Clutter.BindCoordinate.SIZE}));
        this.clockButton = new St.Button({child: clockPlaceholder, style_class: 'dyno-clock-button',
            x_align: Clutter.ActorAlign.CENTER, reactive: true, can_focus: true, track_hover: true,
            accessible_name: 'Activity and search'});
        this.headerCenter = new St.Bin({child: this.clockButton, x_expand: true});
        const homeAction = () => this.open('home');
        this.clockButton.connect('clicked', homeAction);
        this._actions.set(this.clockButton, homeAction);
        this.notifications = this._button('preferences-system-notifications-symbolic', 'Notifications', () => this.showPage('notifications'));
        this.calendar = this._button('x-office-calendar-symbolic', 'Calendar', () => this.showPage('calendar'));
        this.headerCapture = icon('camera-photo-symbolic', 14);
        this.headerCapture.y_align = Clutter.ActorAlign.CENTER;
        this.headerCapture.visible = false;
        this.headerLeft.add_child(this.calendar);
        this.headerLeft.add_child(this.headerCapture);
        this.notifications.x_align = Clutter.ActorAlign.END;
        this.headerRight.set_child(this.notifications);
        for (const child of [this.headerLeft, this.headerCenter, this.headerRight])
            this.header.add_child(child);
        this.content.add_child(this.header);
        this.bannerHost = new St.Bin({style_class: 'dyno-banner-host', visible: false,
            clip_to_allocation: true, x_expand: true});
        this.content.add_child(this.bannerHost);

        this.home = vertical({style_class: 'dyno-home'});
        this.content.add_child(this.home);
        this.mediaCard = vertical({style_class: 'dyno-media'});
        const info = new St.BoxLayout({style_class: 'dyno-media-info'});
        this.art = icon('audio-x-generic-symbolic', 64);
        this.artBin = new St.Bin({style_class: 'dyno-art', child: this.art});
        this.artBin.clip_to_allocation = true;
        info.add_child(this.artBin);
        const text = vertical({style_class: 'dyno-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.mediaState = label('READY WHEN YOU ARE', 'dyno-eyebrow');
        this.trackTitle = label('Nothing playing', 'dyno-track-title');
        this.trackTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.trackArtist = label('Audio and video controls appear here.', 'dyno-muted');
        this.trackArtist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        for (const child of [this.mediaState, this.trackTitle, this.trackArtist])
            text.add_child(child);
        info.add_child(text);
        this.mediaCard.add_child(info);
        this.playback = new St.BoxLayout({style_class: 'dyno-playback'});
        this.previous = this._button('media-skip-backward-symbolic', 'Previous track', () => this.media.current?.previous());
        this.play = this._button('media-playback-start-symbolic', 'Play', () => this.media.current?.playPause(), 'dyno-play');
        this.next = this._button('media-skip-forward-symbolic', 'Next track', () => this.media.current?.next());
        this.openPlayer = this._button('window-new-symbolic', 'Open media application', () => {
            const player = this.media.current;
            this.close(false);
            player?.raise();
        });
        this.cyclePlayer = this._button('view-refresh-symbolic', 'Switch media player', () => this.media.cycle());
        for (const child of [this.previous, this.play, this.next])
            this.playback.add_child(child);
        this.playerName = label('', 'dyno-player-name');
        this.playerName.x_expand = true;
        this.playerName.x_align = Clutter.ActorAlign.END;
        this.playback.add_child(this.playerName);
        this.playback.add_child(this.cyclePlayer);
        this.playback.add_child(this.openPlayer);
        this.mediaCard.add_child(this.playback);
        this.home.add_child(this.mediaCard);

        this.entry = new St.Entry({
            style_class: 'dyno-search',
            hint_text: 'Search apps, files, and actions…',
            primary_icon: icon('system-search-symbolic'),
            can_focus: true, x_expand: true,
        });
        this.entry.clutter_text.set_single_line_mode(true);
        this.entry.clutter_text.connect('text-changed', () => {
            this._activateWhenReady = false;
            this.search.setQuery(this.entry.get_text());
        });
        this.entry.clutter_text.connect('activate', () => this._activateDefault());
        this.home.add_child(this.entry);
        this.resultsBox = vertical({style_class: 'dyno-results', x_expand: true});
        this.resultsScroll = new St.ScrollView({
            child: this.resultsBox, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            visible: false, style_class: 'dyno-results-scroll',
        });
        this.home.add_child(this.resultsScroll);
        this.searchStatus = label('', 'dyno-muted dyno-search-status');
        this.searchStatus.visible = false;
        this.home.add_child(this.searchStatus);

        this.nativeHost = vertical({x_expand: true, y_expand: true});
        this.nativeScroll = new St.ScrollView({
            child: this.nativeHost, visible: false,
            overlay_scrollbars: true, hscrollbar_policy: St.PolicyType.NEVER,
            style_class: 'dyno-native',
        });
        this.content.add_child(this.nativeScroll);
        this.footer = new St.BoxLayout({style_class: 'dyno-footer'});
        this.footerKeys = label('↑ Playback   ↓ Results', '');
        this.footerEscape = label('Esc Close', '');
        this.footerEscape.x_expand = true;
        this.footerEscape.x_align = Clutter.ActorAlign.END;
        this.footer.add_child(this.footerKeys);
        this.footer.add_child(this.footerEscape);
        this.content.add_child(this.footer);
    }

    setAnchor(anchor, clockHome, clockSlot) {
        this._anchor = anchor;
        this._clockHome = clockHome;
        this._clockSlot = clockSlot;
        this._dockClock();
    }

    setClock(text) {
        this._clock = text;
        this._syncClockText();
    }

    setCaptureFeedback(active) {
        this.headerCapture.visible = active;
        this.background[active ? 'add_style_class_name' : 'remove_style_class_name']('dyno-capture-active');
    }

    setWorkspaceFeedback(index) {
        this._workspaceFeedback = index;
        this._syncClockText(true);
    }

    _syncClockText(animate = false) {
        const text = !this.isOpen && !this.isPreview && this._workspaceFeedback
            ? `Workspace ${this._workspaceFeedback}` : this._clock ?? '';
        if (this.heading.text === text)
            return;
        this.heading.text = text;
        if (this._clockFloating) {
            this._moveClock(this.isOpen || this.isPreview, 0);
        } else if (animate) {
            this.heading.translation_y = 3;
            this.heading.ease({translation_y: 0, duration: 140,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        }
    }

    _liftClock() {
        if (this._clockFloating)
            return;
        // A queued banner can open synchronously as collapse completes,
        // before the reparented label receives another allocation. The fixed
        // panel slot stays allocated throughout and is a stable origin.
        const [slotX, slotY] = this._clockSlot.get_transformed_position();
        const [slotWidth, slotHeight] = this._clockSlot.get_transformed_size();
        const [, width] = this.heading.clutter_text.get_preferred_width(-1);
        const [, height] = this.heading.clutter_text.get_preferred_height(-1);
        this.heading.remove_all_transitions();
        this.heading.get_parent()?.remove_child(this.heading);
        this.actor.add_child(this.heading);
        this.heading.translation_y = 0;
        this.heading.set_size(width, height);
        this.heading.set_position(slotX + (slotWidth - width) / 2 - this.actor.x,
            slotY + (slotHeight - height) / 2 - this.actor.y);
        this._clockFloating = true;
    }

    _moveClock(expanded, duration) {
        if (!this._clockFloating)
            return;
        const [, width] = this.heading.clutter_text.get_preferred_width(-1);
        const [, height] = this.heading.clutter_text.get_preferred_height(-1);
        this.heading.set_size(width, height);
        let x, y;
        if (expanded) {
            const box = this.content.get_theme_node().get_content_box(new Clutter.ActorBox({
                x1: 0, y1: 0, x2: this.actor.width, y2: this.actor.height}));
            const [, headerHeight] = this.header.get_preferred_height(box.x2 - box.x1);
            x = (this.actor.width - width) / 2;
            y = box.y1 + (headerHeight - height) / 2;
        } else {
            const [slotX, slotY] = this._clockSlot.get_transformed_position();
            const [slotWidth, slotHeight] = this._clockSlot.get_transformed_size();
            x = slotX + (slotWidth - width) / 2 - this.actor.x;
            y = slotY + (slotHeight - height) / 2 - this.actor.y;
        }
        this.heading.ease({x, y, duration, mode: expanded
            ? Clutter.AnimationMode.EASE_OUT_CUBIC : Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
    }

    _dockClock() {
        if (!this._clockHome)
            return;
        this.heading.remove_all_transitions();
        this.heading.get_parent()?.remove_child(this.heading);
        this.heading.set_position(0, 0);
        this.heading.set_size(-1, -1);
        this.heading.fixed_position_set = false;
        this.heading.translation_y = 0;
        this._clockHome.add_child(this.heading);
        this._clockFloating = false;
        this._syncClockText();
    }

    setAudioPulse(active) {
        this.background[active ? 'add_style_class_name' : 'remove_style_class_name']('dyno-audio-active');
    }

    setEventPulse(active) {
        this.background[active ? 'add_style_class_name' : 'remove_style_class_name']('dyno-event-active');
    }

    setUnread(unread) {
        this.notifications[unread ? 'add_style_class_name' : 'remove_style_class_name']('dyno-has-unread');
        this.notifications.accessible_name = unread ? 'Notifications — unread messages' : 'Notifications';
    }

    _sensitive(button, value) {
        button.reactive = Boolean(value);
        button.can_focus = Boolean(value);
        button.opacity = value ? 255 : 70;
    }

    _refreshMedia(resize = true) {
        const player = this.media.current;
        const playing = player?.status === 'Playing';
        this.mediaState.text = player ? (playing ? 'NOW PLAYING' : 'PAUSED') : 'READY WHEN YOU ARE';
        this.trackTitle.text = player?.trackTitle || 'Nothing playing';
        this.trackArtist.text = player?.trackArtists.join(' · ') ||
            (player ? player.source.title : 'Audio and video controls appear here.');
        this.playerName.text = player?.source.title ?? '';
        this.play.child.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this.play.accessible_name = playing ? 'Pause' : 'Play';
        this.playback.visible = Boolean(player);
        this.cyclePlayer.visible = this.media.count > 1;
        this._sensitive(this.previous, player?.canGoPrevious);
        this._sensitive(this.next, player?.canGoNext);
        this._sensitive(this.play, player?.canPlay);
        const cover = player?.trackCoverUrl ?? '';
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const resourceScale = (this._anchor ?? this.actor).get_resource_scale();
        if (cover !== this._cover || scale !== this._artScale || resourceScale !== this._artResourceScale) {
            this._cover = cover;
            this._artScale = scale;
            this._artResourceScale = resourceScale;
            const oldArt = this.art;
            if (cover) {
                this.art = St.TextureCache.get_default().load_file_async(
                    Gio.File.new_for_uri(cover), -1, 72, scale, resourceScale);
                this.art.content_gravity = Clutter.ContentGravity.RESIZE_ASPECT;
                this.art.x_align = Clutter.ActorAlign.CENTER;
                this.art.y_align = Clutter.ActorAlign.CENTER;
            } else {
                this.art = icon('audio-x-generic-symbolic', 40);
            }
            this.artBin.set_child(this.art);
            oldArt.destroy();
        }
        if (resize && this.isOpen && this.page === 'home')
            this._resize();
    }

    _renderResults() {
        if (this._disposed)
            return;
        const active = global.stage.get_key_focus();
        const focusedKey = [...this._rows].find(([, row]) => row === active)?.[0];
        const wanted = new Set(this.search.results.map(result => result.key));
        for (const [key, row] of this._rows) {
            if (!wanted.has(key)) {
                this._actions.delete(row);
                row.destroy();
                this._rows.delete(key);
            }
        }
        this.search.results.forEach((result, index) => {
            let row = this._rows.get(result.key);
            if (!row) {
                row = new St.Button({
                    style_class: 'dyno-result', x_expand: true,
                    reactive: true, can_focus: true, track_hover: true,
                });
                const content = new St.BoxLayout({style_class: 'dyno-result-content', x_expand: true});
                content.add_child(result.meta.createIcon?.(24) ?? icon('application-x-executable-symbolic', 24));
                const text = vertical({x_expand: true});
                row._title = label(result.meta.name ?? '', 'dyno-result-title');
                row._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                row._detail = label(result.meta.description ?? result.provider.appInfo?.get_name() ?? 'Application', 'dyno-result-detail');
                row._detail.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                text.add_child(row._title);
                text.add_child(row._detail);
                content.add_child(text);
                row.set_child(content);
                content.x_align = Clutter.ActorAlign.FILL;
                const activate = () => this._activateResult(row._result);
                row.connect('clicked', activate);
                row.connect('key-focus-in', () => ensureActorVisibleInScrollView(this.resultsScroll, row));
                this._actions.set(row, activate);
                this._rows.set(result.key, row);
                this.resultsBox.add_child(row);
            }
            row._result = result;
            row._title.text = result.meta.name ?? '';
            row.accessible_name = `${result.meta.name}, ${row._detail.text}`;
            row[index === 0 ? 'add_style_pseudo_class' : 'remove_style_pseudo_class']('default');
            this.resultsBox.set_child_at_index(row, index);
        });
        if (focusedKey) {
            const row = this._rows.get(focusedKey);
            if (row)
                row.grab_key_focus();
            else
                this.entry.grab_key_focus();
        }
        const count = this.search.results.length;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.resultsScroll.visible = count > 0;
        this.resultsScroll.height = Math.min(4, count) * 54 * scale;
        this.searchStatus.visible = Boolean(this.search.query) && !count;
        this.searchStatus.text = this.search.pending ? 'Searching…' : 'No results';
        if (this.isOpen && this.page === 'home')
            this._resize();
        if (this._activateWhenReady && count) {
            this._activateWhenReady = false;
            this._activateResult(this.search.results[0]);
        }
    }

    _activateDefault() {
        if (this.search.results.length) {
            this._activateResult(this.search.results[0]);
        } else if (this.search.query) {
            this._activateWhenReady = true;
            this.search.flush();
        }
    }

    _activateResult(result) {
        this.close(false);
        this.search.activate(result);
    }

    open(page = 'home') {
        if (this._disposed || Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
            return;
        if (this.isOpen) {
            this.onEvent?.();
            this.showPage(page);
            return;
        }
        const wasVisible = this.actor.visible;
        this._epoch++;
        this.isOpen = true;
        this.isPreview = false;
        this.onEvent?.();
        this._restoreBanner();
        this.actor.reactive = true;
        this.actor.show();
        this.actor.get_parent().set_child_above_sibling(this.actor, null);
        this.showPage(page, false);
        this._resize(false);
        this._liftClock();
        const anchor = this._anchorRect();
        if (!wasVisible) {
            this.background.set_position(anchor.x - this.actor.x, anchor.y - this.actor.y);
            this.background.set_size(anchor.width, anchor.height);
            this.contentPosition.translation_x = this.actor.x - anchor.x;
            this.contentPosition.translation_y = this.actor.y - anchor.y;
            this.content.opacity = 0;
            this.content.translation_y = -6;
        }
        if (this._anchor)
            this._anchor.opacity = 0;
        if (!this._restoreBannerBlock)
            this._bannerWasBlocked = Main.messageTray._bannerBlocked;
        this._restoreBannerBlock = false;
        Main.messageTray.bannerBlocked = true;
        this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP});
        this._animateBackground(this.actor.width, this.actor.height, 230);
        this.content.ease({opacity: 255, translation_y: 0, duration: 170, delay: wasVisible ? 0 : 55, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this._focusPage();
    }

    showPage(page, animate = true) {
        if (!this.isOpen) {
            this.open(page);
            return;
        }
        this._restoreBorrowed();
        this.page = page;
        this.bannerHost.hide();
        this.footer.show();
        this.home.visible = page === 'home';
        this.nativeScroll.visible = page !== 'home';
        this.setClock(this._clock ?? '');
        this.notifications[page === 'notifications' ? 'add_style_pseudo_class' : 'remove_style_pseudo_class']('checked');
        this.calendar[page === 'calendar' ? 'add_style_pseudo_class' : 'remove_style_pseudo_class']('checked');
        this.footerKeys.text = page === 'home' ? '↑ Playback   ↓ Results' : 'Arrow keys to navigate';
        this.footerEscape.text = page === 'home' ? 'Esc Close' : 'Esc Back';
        if (page !== 'home') {
            this.search.cancel();
            const actor = page === 'calendar'
                ? this.dateMenu._calendar.get_parent()
                : this.dateMenu._messageList;
            const parent = actor.get_parent();
            this._borrowed = {actor, parent, index: parent.get_children().indexOf(actor), visible: actor.visible};
            parent.remove_child(actor);
            this.nativeHost.add_child(actor);
            actor.show();
            if (page === 'calendar') {
                const now = new Date();
                this.dateMenu._calendar.setDate(now);
                this.dateMenu._date.setDate(now);
                this.dateMenu._eventsItem.setDate(now);
            }
        } else {
            this._refreshMedia(false);
            if (this.entry.get_text().trim()) {
                const query = this.entry.get_text();
                this.search.reset();
                this.search.setQuery(query);
            }
        }
        if (animate) {
            this._resize();
            this._focusPage();
        }
        const body = page === 'home' ? this.home : this.nativeScroll;
        body.remove_all_transitions();
        body.opacity = animate ? 0 : 255;
        body.translation_y = animate ? 4 : 0;
        if (animate)
            body.ease({opacity: 255, translation_y: 0, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _restoreBorrowed() {
        if (!this._borrowed)
            return;
        const {actor, parent, index, visible} = this._borrowed;
        actor.get_parent()?.remove_child(actor);
        parent.insert_child_at_index(actor, index);
        actor.visible = visible;
        this._borrowed = null;
    }

    showPreview(bin) {
        if (this.isOpen || this._disposed || Main.sessionMode.isLocked)
            return;
        if (this.isPreview && this._bannerBorrowed?.bin === bin) {
            this._resize();
            return;
        }
        const wasVisible = this.actor.visible;
        this._epoch++;
        this.isPreview = true;
        this.onEvent?.();
        this._syncClockText();
        this.page = 'banner';
        this._restoreBorrowed();
        this.home.hide();
        this.nativeScroll.hide();
        this.footer.hide();
        this.notifications.remove_style_pseudo_class('checked');
        this.calendar.remove_style_pseudo_class('checked');
        this.bannerHost.show();
        this._restoreBanner();
        const parent = bin.get_parent();
        const saved = {bin, parent};
        this._bannerBorrowed = saved;
        saved.hoverId = bin.connect('notify::hover', () => {
            if (!this.isPreview)
                return;
            const tray = Main.messageTray;
            tray._notificationHovered = bin.hover;
            tray._pointerInNotification = bin.hover;
            if (bin.hover)
                tray._resetNotificationLeftTimeout();
            else
                tray._updateNotificationTimeout(1000);
            tray._updateState();
        });
        saved.destroyId = bin.connect('destroy', () => {
            if (this._bannerBorrowed === saved) {
                this._bannerBorrowed = null;
                this.hidePreview(false);
            }
        });
        parent.remove_child(bin);
        this.bannerHost.set_child(bin);
        this.actor.show();
        this.actor.reactive = true;
        this.actor.get_parent().set_child_above_sibling(this.actor, null);
        this._resize(false);
        this._liftClock();
        if (!wasVisible) {
            const anchor = this._anchorRect();
            this.background.set_position(anchor.x - this.actor.x, anchor.y - this.actor.y);
            this.background.set_size(anchor.width, anchor.height);
            this.contentPosition.translation_x = this.actor.x - anchor.x;
            this.contentPosition.translation_y = this.actor.y - anchor.y;
            this.content.opacity = 0;
        }
        this._anchor.opacity = 0;
        this._animateBackground(this.actor.width, this.actor.height, 210);
        this.content.ease({opacity: 255, translation_y: 0, duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    _restoreBanner() {
        if (!this._bannerBorrowed)
            return;
        const {bin, parent, hoverId, destroyId} = this._bannerBorrowed;
        this._bannerBorrowed = null;
        bin.disconnect(hoverId);
        bin.disconnect(destroyId);
        Main.messageTray._notificationFocusGrabber.ungrabFocus();
        Main.messageTray._notificationFocusGrabber._actor = Main.messageTray._bannerBin;
        this.bannerHost.set_child(null);
        parent.add_child(bin);
    }

    hidePreview(animate = true) {
        if (!this.isPreview && !this._bannerBorrowed)
            return;
        this.isPreview = false;
        const epoch = ++this._epoch;
        this._targetWidth = -1;
        const complete = () => {
            if (epoch !== this._epoch)
                return;
            this._restoreBanner();
            if (!this.isOpen) {
                this._dockClock();
                this.actor.hide();
                this._anchor.opacity = 255;
            }
        };
        this.background.remove_all_transitions();
        this.contentPosition.remove_all_transitions();
        this.content.remove_all_transitions();
        if (!animate || !St.Settings.get().enable_animations) {
            complete();
            return;
        }
        const anchor = this._anchorRect();
        this._moveClock(false, 180);
        this.content.ease({opacity: 0, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this.background.ease({x: anchor.x - this.actor.x, y: anchor.y - this.actor.y,
            width: anchor.width, height: anchor.height, duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC, onComplete: complete});
        this.contentPosition.ease({translation_x: this.actor.x - anchor.x,
            translation_y: this.actor.y - anchor.y, duration: 180,
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
    }

    _focusPage() {
        if (this.page === 'home')
            this.entry.grab_key_focus();
        else
            (this.page === 'calendar' ? this.calendar : this.notifications).grab_key_focus();
    }

    _anchorRect() {
        const [x, y] = this._anchor?.get_transformed_position() ?? [0, 0];
        const [width, height] = this._anchor?.get_transformed_size() ?? [160, 24];
        return {x, y, width, height};
    }

    _resize(animate = true) {
        if (!this.isOpen && !this.isPreview)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const monitor = Main.layoutManager.findMonitorForActor(this._anchor ?? this.actor)
            ?? Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const anchor = this._anchorRect();
        const width = Math.min((this.page === 'calendar' ? 380 : 540) * scale, monitor.width - 24 * scale);
        const x = monitor.x + (monitor.width - width) / 2;
        const y = Math.max(monitor.y + 3 * scale, anchor.y);
        this.content.width = width;
        this.nativeScroll.height = Math.min(400 * scale, monitor.height - 150 * scale);
        const [, preferredHeight] = this.content.get_preferred_height(width);
        const height = Math.min(preferredHeight, monitor.y + monitor.height - y - 12 * scale);
        const oldX = this.actor.x;
        const oldY = this.actor.y;
        this.actor.set_position(Math.round(x), Math.round(y));
        if (this._clockFloating) {
            if (oldX !== this.actor.x)
                this.heading.x += oldX - this.actor.x;
            if (oldY !== this.actor.y)
                this.heading.y += oldY - this.actor.y;
        }
        if (animate) {
            if (oldX !== this.actor.x) {
                this.background.x += oldX - this.actor.x;
                this.contentPosition.translation_x = -this.background.x;
            }
            if (oldY !== this.actor.y) {
                this.background.y += oldY - this.actor.y;
                this.contentPosition.translation_y = -this.background.y;
            }
        }
        this.actor.set_size(width, height);
        this.contentPosition.set_size(width, preferredHeight);
        if (animate)
            this._animateBackground(width, height, 180);
    }

    _animateBackground(width, height, duration) {
        this._moveClock(true, duration);
        // Only the empty background changes geometry. Text and controls keep
        // their final allocation; no scale-distorted text or JS frame loop.
        if (this._targetWidth === width && this._targetHeight === height &&
            this._targetX === this.actor.x && this._targetY === this.actor.y)
            return;
        this._targetWidth = width;
        this._targetHeight = height;
        this._targetX = this.actor.x;
        this._targetY = this.actor.y;
        this.background.ease({x: 0, y: 0, width, height, duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        this.contentPosition.ease({translation_x: 0, translation_y: 0, duration,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    close(animate = true) {
        if (this.isPreview || this._bannerBorrowed) {
            this.hidePreview(animate);
            return;
        }
        if (!this.isOpen && !this.actor.visible)
            return;
        if (animate && this.isOpen)
            this.onEvent?.();
        const epoch = ++this._epoch;
        this._targetWidth = -1;
        this.isOpen = false;
        this.actor.reactive = false;
        this.search.reset();
        this.entry.set_text('');
        this._activateWhenReady = false;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
            this._restoreBannerBlock = true;
        }
        const complete = () => {
            if (epoch !== this._epoch)
                return;
            this._dockClock();
            this.actor.hide();
            this._restoreBorrowed();
            if (this._anchor)
                this._anchor.opacity = 255;
            this._clearResults();
            if (this._restoreBannerBlock) {
                this._restoreBannerBlock = false;
                Main.messageTray.bannerBlocked = this._bannerWasBlocked;
            }
        };
        this.content.remove_all_transitions();
        this.background.remove_all_transitions();
        this.contentPosition.remove_all_transitions();
        if (!animate || !St.Settings.get().enable_animations) {
            complete();
            return;
        }
        const anchor = this._anchorRect();
        this._moveClock(false, 190);
        this.content.ease({opacity: 0, translation_y: -4, duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this.background.ease({
            x: anchor.x - this.actor.x, y: anchor.y - this.actor.y,
            width: anchor.width, height: anchor.height,
            duration: 190, mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC,
            onComplete: complete,
        });
        this.contentPosition.ease({translation_x: this.actor.x - anchor.x,
            translation_y: this.actor.y - anchor.y, duration: 190,
            mode: Clutter.AnimationMode.EASE_IN_OUT_CUBIC});
    }

    _clearResults() {
        for (const row of this._rows.values()) {
            this._actions.delete(row);
            row.destroy();
        }
        this._rows.clear();
        this.resultsScroll.hide();
        this.searchStatus.hide();
    }

    _captured(event) {
        if (!this.isOpen)
            return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        if ([Clutter.EventType.BUTTON_PRESS, Clutter.EventType.TOUCH_BEGIN].includes(event.type()) &&
            (!target || !this.actor.contains(target))) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (event.type() !== Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;
        const key = event.get_key_symbol();
        const focus = global.stage.get_key_focus();
        if (key === Clutter.KEY_Escape) {
            if (this.page !== 'home') {
                this.onEvent?.();
                this.showPage('home');
            } else
                this.close();
            return Clutter.EVENT_STOP;
        }
        if (key === Clutter.KEY_Tab || key === Clutter.KEY_ISO_Left_Tab) {
            const backwards = key === Clutter.KEY_ISO_Left_Tab || (event.get_state() & Clutter.ModifierType.SHIFT_MASK);
            this.actor.navigate_focus(focus, backwards ? St.DirectionType.TAB_BACKWARD : St.DirectionType.TAB_FORWARD, true);
            return Clutter.EVENT_STOP;
        }
        const editing = focus === this.entry.clutter_text || focus === this.entry;
        if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || (key === Clutter.KEY_space && !editing)) {
            if (editing)
                this._activateDefault();
            else if (this._actions.has(focus))
                this._actions.get(focus)();
            else
                return Clutter.EVENT_PROPAGATE;
            return Clutter.EVENT_STOP;
        }
        if (![Clutter.KEY_Up, Clutter.KEY_Down, Clutter.KEY_Left, Clutter.KEY_Right].includes(key))
            return Clutter.EVENT_PROPAGATE;
        const header = [this.calendar, this.clockButton, this.notifications];
        const playback = [this.previous, this.play, this.next, this.cyclePlayer, this.openPlayer].filter(b => b.visible && b.reactive && this.playback.visible);
        const rows = this.resultsBox.get_children();
        let next;
        if (editing) {
            if (key === Clutter.KEY_Up)
                next = this.playback.visible ? this.play : this.notifications;
            if (key === Clutter.KEY_Down)
                next = rows[0];
        } else if (header.includes(focus)) {
            if (key === Clutter.KEY_Left || key === Clutter.KEY_Right)
                next = header[Math.max(0, Math.min(header.length - 1, header.indexOf(focus) + (key === Clutter.KEY_Left ? -1 : 1)))];
            else if (key === Clutter.KEY_Down) {
                if (this.page === 'home')
                    next = this.playback.visible ? this.play : this.entry;
                else {
                    this.nativeHost.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
                    return Clutter.EVENT_STOP;
                }
            }
        } else if (this.page === 'home' && playback.includes(focus)) {
            if (key === Clutter.KEY_Down)
                next = this.entry;
            else if (key === Clutter.KEY_Up)
                next = this.notifications;
            else
                next = playback[Math.max(0, Math.min(playback.length - 1, playback.indexOf(focus) + (key === Clutter.KEY_Left ? -1 : 1)))];
        } else if (rows.includes(focus)) {
            const index = rows.indexOf(focus);
            if (key === Clutter.KEY_Up)
                next = index ? rows[index - 1] : this.entry;
            else if (key === Clutter.KEY_Down)
                next = rows[Math.min(index + 1, rows.length - 1)];
        }
        if (next) {
            next.grab_key_focus();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    destroy() {
        this.close(false);
        this._disposed = true;
        this.media.destroy();
        this.search.destroy();
        this._restoreBorrowed();
        this._restoreBanner();
        global.focus_manager.remove_group(this.actor);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
        this._actions.clear();
        this.onMediaChanged = null;
    }
}
