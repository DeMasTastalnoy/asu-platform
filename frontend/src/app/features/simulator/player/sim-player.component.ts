import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import Konva from 'konva';

interface ActionLog {
  ts: string;
  element_id: string;
  action: string;
  value: any;
  step_index: number;
}

@Component({
  selector: 'app-sim-player',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sim-player.component.html',
  styleUrl: './sim-player.component.scss',
})
export class SimPlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('konvaContainer') konvaContainer!: ElementRef;

  stage!: Konva.Stage;
  layer!: Konva.Layer;

  template: any = null;
  loading = true;
  started = false;
  finished = false;
  submitting = false;

  actionLog: ActionLog[] = [];
  startTime!: Date;
  elapsed = 0;
  timerInterval: any;

  simulationId: string = '';
  enrollmentId: string | null = null;
  user: any;

  // Состояние переменных симуляции
  variables: Record<string, any> = {};

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.simulationId = this.route.snapshot.paramMap.get('id') ?? '';
    this.enrollmentId = this.route.snapshot.queryParamMap.get('enrollment');
    this.loadTemplate();
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.stage) this.stage.destroy();
  }

  loadTemplate(): void {
    this.api.get<any>(`simulations/templates/${this.simulationId}/`).subscribe({
      next: (tmpl) => {
        this.template = tmpl;
        this.loading = false;
        setTimeout(() => this.initCanvas(), 100);
      },
      error: () => { this.loading = false; },
    });
  }

  initCanvas(): void {
    if (!this.konvaContainer) return;

    this.stage = new Konva.Stage({
      container: this.konvaContainer.nativeElement,
      width:  this.template.canvas_w ?? 1100,
      height: this.template.canvas_h ?? 580,
      draggable: true,
    });

    this.layer = new Konva.Layer();
    this.stage.add(this.layer);

    // Grid
    const gridLayer = new Konva.Layer();
    this.drawGrid(gridLayer, this.template.canvas_w ?? 1100, this.template.canvas_h ?? 580);
    this.stage.add(gridLayer);
    gridLayer.moveToBottom();

    // Восстанавливаем элементы из JSON
    this.restoreElements(this.template.elements ?? []);
    this.layer.draw();

    this.initNavigation();
  }

  // ── Навигация по холсту ──────────────────────────────────────────────────────

  private readonly ZOOM_FACTOR = 1.05;
  private readonly ZOOM_MIN    = 0.2;
  private readonly ZOOM_MAX    = 3;

  initNavigation(): void {
    this.stage.on('wheel', (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const oldScale = this.stage.scaleX();
      const pointer  = this.stage.getPointerPosition()!;

      // Точка на «логическом» холсте под курсором
      const origin = {
        x: (pointer.x - this.stage.x()) / oldScale,
        y: (pointer.y - this.stage.y()) / oldScale,
      };

      const direction = e.evt.deltaY < 0 ? 1 : -1;
      const newScale  = Math.min(
        this.ZOOM_MAX,
        Math.max(this.ZOOM_MIN, direction > 0
          ? oldScale * this.ZOOM_FACTOR
          : oldScale / this.ZOOM_FACTOR,
        ),
      );

      this.stage.scale({ x: newScale, y: newScale });
      this.stage.position({
        x: pointer.x - origin.x * newScale,
        y: pointer.y - origin.y * newScale,
      });
    });
  }

  fitToScreen(): void {
    const wrapper = this.konvaContainer.nativeElement.parentElement as HTMLElement;
    const vw = wrapper.clientWidth;
    const vh = wrapper.clientHeight;
    const cw = this.template.canvas_w ?? 1100;
    const ch = this.template.canvas_h ?? 580;

    if (vw > 0 && vh > 0) {
      const scale = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, Math.min(vw / cw, vh / ch)));
      this.stage.scale({ x: scale, y: scale });
      this.stage.position({
        x: Math.max(0, (vw - cw * scale) / 2),
        y: Math.max(0, (vh - ch * scale) / 2),
      });
    } else {
      // Fallback: сбросить в исходное состояние
      this.stage.scale({ x: 1, y: 1 });
      this.stage.position({ x: 0, y: 0 });
    }
  }

  drawGrid(layer: Konva.Layer, w: number, h: number): void {
    const step = 20;
    for (let x = 0; x <= w; x += step) {
      layer.add(new Konva.Line({ points: [x, 0, x, h], stroke: '#e8ecf0', strokeWidth: 0.5 }));
    }
    for (let y = 0; y <= h; y += step) {
      layer.add(new Konva.Line({ points: [0, y, w, y], stroke: '#e8ecf0', strokeWidth: 0.5 }));
    }
  }

  restoreElements(elements: any[]): void {
    elements.forEach(el => {
      this.variables[el.variable] = false;
      const node = this.buildNode(el);
      if (node) {
        node.setAttrs({ elementId: el.id, variable: el.variable, label: el.label, elementType: el.type, canvasProps: el.props });
        if (this.started) {
          node.on('click', () => this.onElementClick(node as any, el));
        }
        this.layer.add(node as any);
      }
    });
  }

  buildNode(el: any): any {
    const p = el.props ?? {};
  const x = el.x ?? 0;
  const y = el.y ?? 0;
  const w = Math.max(el.width ?? 60, 20);   // минимум 20px
  const h = Math.max(el.height ?? 60, 20);  // минимум 20px

    switch (el.type) {
      case 'button': {
        const g = new Konva.Group({ x, y });
        const r = Math.min(w, h) / 2;
        g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, fill: p.offColor ?? '#555', stroke: p.color ?? '#4CAF50', strokeWidth: 3, name: 'body' }));
        g.add(new Konva.Text({ x: 0, y: r * 2 + 4, width: w, text: el.label, fontSize: 10, fill: '#aaa', align: 'center' }));
        return g;
      }
      case 'lamp': {
        const g = new Konva.Group({ x, y });
        const r = Math.min(w, h) / 2;
        g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, fill: p.offColor ?? '#333', stroke: p.color ?? '#4CAF50', strokeWidth: 2, name: 'body' }));
        g.add(new Konva.Text({ x: 0, y: r * 2 + 4, width: w, text: el.label, fontSize: 10, fill: '#aaa', align: 'center' }));
        return g;
      }
      case 'pipe':
        return new Konva.Rect({ x, y, width: w, height: h, fill: p.color ?? '#1E88E5', cornerRadius: Math.min(w, h) / 3 });
      case 'gauge': {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Circle({ x: w/2, y: h/2, radius: w/2-2, fill: '#1A2A3A', stroke: '#4FC3F7', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: 0, y: h/2-10, width: w, text: '0.0', fontSize: 16, fill: '#4FC3F7', align: 'center', fontStyle: 'bold', name: 'value' }));
        g.add(new Konva.Text({ x: 0, y: h/2+8, width: w, text: p.unit ?? '', fontSize: 10, fill: '#607D8B', align: 'center' }));
        g.add(new Konva.Text({ x: 0, y: h+4, width: w, text: el.label, fontSize: 10, fill: '#aaa', align: 'center' }));
        return g;
      }
      case 'display': {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: w, height: h, fill: '#0D1F2D', stroke: '#4FC3F7', strokeWidth: 1, cornerRadius: 4 }));
        g.add(new Konva.Text({ x: 4, y: h/2-9, width: w-8, text: '---', fontSize: p.fontSize ?? 18, fill: '#4FC3F7', align: 'center', name: 'value' }));
        return g;
      }
      case 'sensor': {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: w, height: h-16, fill: '#1A2A3A', stroke: '#607D8B', strokeWidth: 1, cornerRadius: 4 }));
        g.add(new Konva.Text({ x: 0, y: 8, width: w, text: '0.0', fontSize: 16, fill: '#4FC3F7', align: 'center', fontStyle: 'bold', name: 'value' }));
        g.add(new Konva.Text({ x: 0, y: 28, width: w, text: p.unit ?? '', fontSize: 11, fill: '#607D8B', align: 'center' }));
        g.add(new Konva.Text({ x: 0, y: h-14, width: w, text: el.label, fontSize: 10, fill: '#aaa', align: 'center' }));
        return g;
      }
      case 'valve': {
        const g = new Konva.Group({ x, y });
        const cx = w/2, cy = h/2, r = Math.min(w,h)/2-4;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: 'transparent', stroke: p.color ?? '#FF9800', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx-r, cy, cx+r, cy], stroke: p.color ?? '#FF9800', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx, cy-r, cx, cy+r], stroke: p.color ?? '#FF9800', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: 0, y: h+2, width: w, text: el.label, fontSize: 10, fill: '#aaa', align: 'center' }));
        return g;
      }
      case 'pump': {
        const g = new Konva.Group({ x, y });
        const r = Math.min(w,h)/2-2;
        g.add(new Konva.Circle({ x: w/2, y: h/2, radius: r, fill: '#1A2A3A', stroke: p.color ?? '#9C27B0', strokeWidth: 2 }));
        g.add(new Konva.RegularPolygon({ x: w/2, y: h/2, sides: 3, radius: r-6, fill: p.color ?? '#9C27B0', rotation: 90 }));
        g.add(new Konva.Text({ x: 0, y: h+2, width: w, text: el.label, fontSize: 10, fill: '#aaa', align: 'center' }));
        return g;
      }
      case 'label':
        return new Konva.Text({ x, y, text: p.text ?? el.label, fontSize: p.fontSize ?? 14, fill: p.color ?? '#607D8B' });
      default: {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: w, height: h, fill: '#1A2A3A', stroke: '#607D8B', strokeWidth: 1, cornerRadius: 4 }));
        g.add(new Konva.Text({ x: 0, y: h/2-9, width: w, text: el.label, fontSize: 12, fill: '#4FC3F7', align: 'center' }));
        return g;
      }
    }
  }

  // ── Gameplay ─────────────────────────────────────────────────────────────────

  startSimulation(): void {
    this.started = true;
    this.startTime = new Date();
    this.timerInterval = setInterval(() => {
      this.elapsed = Math.floor((new Date().getTime() - this.startTime.getTime()) / 1000);
    }, 1000);

    // Навешиваем обработчики на все элементы
    this.layer.getChildren().forEach((node: any) => {
      const elType = node.getAttr('elementType');
      if (elType && elType !== 'pipe' && elType !== 'label') {
        node.listening(true);
        node.style = 'cursor: pointer';
        node.on('click', () => this.onElementClick(node, { type: elType, variable: node.getAttr('variable'), id: node.getAttr('elementId') }));
      }
    });
    this.layer.draw();
  }

  onElementClick(node: any, el: any): void {
    if (!this.started || this.finished) return;

    const currentVal = this.variables[el.variable] ?? false;
    const newVal = !currentVal;
    this.variables[el.variable] = newVal;

    // Визуальная реакция
    this.updateNodeVisual(node, el.type, newVal, el);

    // Применяем правила
    this.applyRules(el.variable, newVal);

    // Записываем в лог
    this.actionLog.push({
      ts: new Date().toISOString(),
      element_id: el.variable,
      action: 'click',
      value: newVal,
      step_index: this.actionLog.length,
    });

    this.layer.draw();
  }

  updateNodeVisual(node: any, type: string, value: boolean, el: any): void {
    const props = node.getAttr('canvasProps') ?? {};
    if (type === 'button' || type === 'lamp') {
      const body = node.findOne('.body');
      if (body) body.fill(value ? (props.color ?? '#4CAF50') : (props.offColor ?? '#555'));
    }
    if (type === 'pump' || type === 'valve') {
      const children = node.getChildren();
      children.forEach((c: any) => { if (c instanceof Konva.Circle) c.fill(value ? (props.color ?? '#9C27B0') : '#1A2A3A'); });
    }
  }

  applyRules(changedVar: string, newVal: any): void {
    const rules = this.template?.rules ?? [];
    rules.forEach((rule: any) => {
      const cond = rule.if;
      if (!cond) return;
      let condMet = false;
      if (cond.variable === changedVar) {
        if (cond.op === 'eq') condMet = newVal === cond.value;
        else if (cond.op === 'neq') condMet = newVal !== cond.value;
      }
      if (condMet && rule.then) {
        rule.then.forEach((action: any) => {
          this.variables[action.variable] = action.set;
          // Обновляем визуал целевого элемента
          const targetNode = this.layer.findOne(`[variable="${action.variable}"]`) as any;
          if (targetNode) this.updateNodeVisual(targetNode, targetNode.getAttr('elementType'), action.set, { props: targetNode.getAttr('canvasProps') });
        });
      }
    });
  }

  finishSimulation(): void {
    this.finished = true;
    this.started = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.submitResults();
  }

  submitResults(): void {
    this.submitting = true;
    const payload: any = {
      simulation_id: +this.simulationId,
      actions_log:   this.actionLog,
      time_spent_sec: this.elapsed,
    };
    if (this.enrollmentId) payload.enrollment_id = +this.enrollmentId;

    this.api.post<any>('simulations/submit/', payload).subscribe({
      next: (res) => {
        this.submitting = false;
        // Если есть moduleId — отмечаем модуль завершённым
        if (this.template?.module) {
          this.api.post(`modules/${this.template.module}/complete/`, { time_spent_sec: this.elapsed }).subscribe();
        }
      },
      error: () => { this.submitting = false; },
    });
  }

  get elapsedStr(): string {
    const m = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const s = (this.elapsed % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}
