import { Modal } from "obsidian";
import type { App } from "obsidian";

const MIN_SCALE = 1;
const MAX_SCALE = 8;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/**
 * Full-screen image viewer for annotation cards.
 *
 * Touchpad: two-finger scroll pans, pinch zooms (Electron reports pinch as
 * ctrl+wheel). Mouse: drag pans, ctrl/⌘+wheel zooms. Escape closes.
 */
export class ImageLightboxModal extends Modal {
	private scale = 1;
	private x = 0;
	private y = 0;
	private img!: HTMLImageElement;
	private viewport!: HTMLElement;
	private cleanup: (() => void)[] = [];

	constructor(app: App, private src: string, private alt: string) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("ra-lightbox-modal");
		this.contentEl.addClass("ra-lightbox");
		this.viewport = this.contentEl.createDiv({ cls: "ra-lightbox__viewport" });
		this.img = this.viewport.createEl("img", {
			attr: { src: this.src, alt: this.alt, draggable: "false" },
		});
		this.img.addEventListener("load", () => this.clamp());
		this.img.addEventListener("dblclick", () => this.reset());
		this.viewport.addEventListener("click", (e) => { if (e.target === this.viewport) this.close(); });
		this.viewport.addEventListener("dblclick", (e) => { if (e.target === this.viewport) this.close(); });

		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			if (e.ctrlKey || e.metaKey) {
				this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
			} else {
				this.panBy(-e.deltaX, -e.deltaY);
			}
		};
		this.viewport.addEventListener("wheel", onWheel, { passive: false });
		this.cleanup.push(() => this.viewport.removeEventListener("wheel", onWheel));

		let drag: { id: number; x: number; y: number } | null = null;
		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0 || e.target !== this.img) return;
			drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
			this.img.setPointerCapture(e.pointerId);
			this.viewport.addClass("is-dragging");
			e.preventDefault();
		};
		const onPointerMove = (e: PointerEvent) => {
			if (!drag || e.pointerId !== drag.id) return;
			this.panBy(e.clientX - drag.x, e.clientY - drag.y);
			drag.x = e.clientX;
			drag.y = e.clientY;
		};
		const onPointerUp = (e: PointerEvent) => {
			if (!drag || e.pointerId !== drag.id) return;
			drag = null;
			this.viewport.removeClass("is-dragging");
		};
		this.img.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
		this.cleanup.push(() => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
		});

		const onResize = () => this.clamp();
		window.addEventListener("resize", onResize);
		this.cleanup.push(() => window.removeEventListener("resize", onResize));

		this.contentEl.addEventListener("click", (e) => {
			if (e.target === this.contentEl) this.close();
		});
		this.applyTransform();
	}

	onClose() {
		for (const remove of this.cleanup) remove();
		this.cleanup = [];
		this.contentEl.empty();
	}

	private applyTransform() {
		this.img.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
	}

	private reset() {
		this.scale = 1;
		this.x = 0;
		this.y = 0;
		this.applyTransform();
	}

	private panBy(dx: number, dy: number) {
		this.x += dx;
		this.y += dy;
		this.clamp();
		this.applyTransform();
	}

	private zoomAt(clientX: number, clientY: number, factor: number) {
		const rect = this.viewport.getBoundingClientRect();
		const cx = clientX - rect.left - rect.width / 2;
		const cy = clientY - rect.top - rect.height / 2;
		const next = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
		const ratio = next / this.scale;
		this.x = cx - (cx - this.x) * ratio;
		this.y = cy - (cy - this.y) * ratio;
		this.scale = next;
		this.clamp();
		this.applyTransform();
	}

	private clamp() {
		const maxX = Math.max(0, (this.img.clientWidth * this.scale - this.viewport.clientWidth) / 2);
		const maxY = Math.max(0, (this.img.clientHeight * this.scale - this.viewport.clientHeight) / 2);
		this.x = clamp(this.x, -maxX, maxX);
		this.y = clamp(this.y, -maxY, maxY);
	}
}

export function openImageLightbox(app: App, src: string, alt: string) {
	new ImageLightboxModal(app, src, alt).open();
}
