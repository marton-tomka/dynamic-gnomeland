import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WorkspaceSwitcherPopup} from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';

// Suppress only the bottom OSD. Its native lifetime still protects dynamic
// workspace bookkeeping. Desktop slide animation and gesture handlers are
// untouched.
export class IslandWorkspaces {
    constructor(feedback) {
        this._feedback = feedback;
        this._manager = global.workspace_manager;
        this._prototype = WorkspaceSwitcherPopup.prototype;
        this._originalDisplay = this._prototype.display;
        const owner = this;
        this._display = function (index) {
            owner._originalDisplay.call(this, index);
            this.remove_transition('opacity');
            this.opacity = 0;
            owner._feedback(index);
        };
        this._prototype.display = this._display;
        this._workspaceId = this._manager.connect('active-workspace-changed', () => {
            this._feedback(this._manager.get_active_workspace_index());
        });
        const popup = Main.wm._workspaceSwitcherPopup;
        if (popup) {
            popup.remove_transition('opacity');
            popup.opacity = 0;
        }
    }

    destroy() {
        this._manager.disconnect(this._workspaceId);
        if (this._prototype.display === this._display)
            this._prototype.display = this._originalDisplay;
        Main.wm._workspaceSwitcherPopup?.display(this._manager.get_active_workspace_index());
        this._feedback = null;
    }
}
