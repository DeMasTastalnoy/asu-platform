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
  ok?: boolean;   // true = правильное действие, false = ошибка
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

  // Сценарный движок
  scenario: any[]     = [];   // reference_scenario отсортированный по step
  currentStepIdx      = 0;
  score               = 0;    // кол-во правильных действий
  errors              = 0;    // кол-во ошибочных кликов
  completionStatus: 'completed' | 'incomplete' | null = null;
  private hintShape: Konva.Shape | null = null;

  // ── Физика котла ──────────────────────────────────────────────────────────────
  /** Нажата ли кнопка «Пуск горелки». */
  private burnerOn = false;
  /** Есть ли в схеме орган управления подачей топлива (задвижка/кран). */
  private fuelControlExists = false;
  /** Текущее значение каждой физической величины. */
  private physicsState: Record<string, number> = {};
  /** Ноды-индикаторы, которые отображают физические величины. */
  private physicsTargets: Array<{ group: any; valueText: any; quantity: string }> = [];
  private physicsInterval: any = null;

  /** Температура кипения — порог, с которого начинает расти давление пара. */
  private readonly BOIL_TEMP = 100;
  /** Ключевые слова органов подачи топлива. */
  private readonly FUEL_KEYS = ['fuel', 'топл', 'газ'];

  /**
   * Конфигурация физических величин:
   *  min     — значение в холодном состоянии (нет нагрева)
   *  max     — установившееся рабочее значение при нагреве
   *  rate    — изменение за один тик (100 мс); 0 для вычисляемых величин
   *  dec     — знаков после запятой при выводе
   *  derived — величина не интегрируется по времени, а вычисляется из других
   *  keys    — ключевые слова в variable/label для привязки ноды к величине
   */
  private readonly PHYSICS: Record<string, { min: number; max: number; rate: number; dec: number; derived?: boolean; keys: string[] }> = {
    temperature: { min: 20, max: 185, rate: 2.2,  dec: 0, keys: ['temp', 'therm', 'термо', 'температ', 't_'] },
    pressure:    { min: 0,  max: 13,  rate: 0,    dec: 1, derived: true, keys: ['pressure', 'press', 'давл', 'маномет', 'p_'] },
    power:       { min: 0,  max: 100, rate: 1.4,  dec: 0, keys: ['power', 'мощн', 'pwr'] },
    level:       { min: 55, max: 72,  rate: 0.25, dec: 0, keys: ['level', 'уровен', 'барабан'] },
  };

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
    this.stopPhysicsLoop();
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


  restoreElements(elements: any[]): void {
    elements.forEach(el => {
      this.variables[el.variable] = false;
      const node = this.buildNode(el);
      if (node) {
        node.setAttrs({ elementId: el.id, variable: el.variable, label: el.label, elementType: el.type, canvasProps: el.props });
        // Явный setAttr гарантирует что findOne('[variable="..."]') найдёт ноду
        node.setAttr('variable', el.variable);
        this.layer.add(node as any);
      }
    });
  }

  /**
   * Внешняя подпись под элементом. Широкий бокс (140px) с переносом по словам,
   * чтобы длинные названия («Задвижка топлива») не обрезались, а центрировались
   * относительно элемента независимо от его ширины.
   */
  private labelText(text: string, w: number, y: number): Konva.Text {
    const boxW = 140;
    return new Konva.Text({
      x: (w - boxW) / 2, y,
      width: boxW, text: text ?? '',
      fontSize: 10, fill: '#ffffff', align: 'center', wrap: 'word',
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
        g.add(this.labelText(el.label, w, r * 2 + 4));
        return g;
      }
      case 'lamp': {
        const g = new Konva.Group({ x, y });
        const r = Math.min(w, h) / 2;
        g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, fill: p.offColor ?? '#333', stroke: p.color ?? '#4CAF50', strokeWidth: 2, name: 'body' }));
        g.add(this.labelText(el.label, w, r * 2 + 4));
        return g;
      }
      case 'pipe':
        return new Konva.Rect({ x, y, width: w, height: h, fill: p.color ?? '#1E88E5', cornerRadius: Math.min(w, h) / 3 });
      case 'gauge': {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Circle({ x: w/2, y: h/2, radius: w/2-2, fill: '#1A2A3A', stroke: '#4FC3F7', strokeWidth: 2 }));
        g.add(new Konva.Text({ x: 0, y: h/2-10, width: w, text: '0.0', fontSize: 16, fill: '#4FC3F7', align: 'center', fontStyle: 'bold', name: 'value' }));
        g.add(new Konva.Text({ x: 0, y: h/2+8, width: w, text: p.unit ?? '', fontSize: 10, fill: '#607D8B', align: 'center' }));
        g.add(this.labelText(el.label, w, h + 4));
        return g;
      }
      case 'display': {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: w, height: h, fill: '#0D1F2D', stroke: '#4FC3F7', strokeWidth: 1, cornerRadius: 4 }));
        // Цифровое значение (обновляется физикой котла); при старте — 0
        g.add(new Konva.Text({ x: 0, y: p.unit ? h/2 - 13 : h/2 - 11, width: w, text: '0', fontSize: p.fontSize ?? 20, fill: '#4FC3F7', align: 'center', fontStyle: 'bold', name: 'value' }));
        if (p.unit) g.add(new Konva.Text({ x: 0, y: h/2 + 9, width: w, text: p.unit, fontSize: 9, fill: '#607D8B', align: 'center' }));
        g.add(this.labelText(el.label, w, h + 4));
        return g;
      }
      case 'sensor': {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: w, height: h-16, fill: '#1A2A3A', stroke: '#607D8B', strokeWidth: 1, cornerRadius: 4 }));
        g.add(new Konva.Text({ x: 0, y: 8, width: w, text: '0.0', fontSize: 16, fill: '#4FC3F7', align: 'center', fontStyle: 'bold', name: 'value' }));
        g.add(new Konva.Text({ x: 0, y: 28, width: w, text: p.unit ?? '', fontSize: 11, fill: '#607D8B', align: 'center' }));
        g.add(this.labelText(el.label, w, h - 14));
        return g;
      }
      case 'valve': {
        const g = new Konva.Group({ x, y });
        const cx = w/2, cy = h/2, r = Math.min(w,h)/2-4;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: 'transparent', stroke: p.color ?? '#FF9800', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx-r, cy, cx+r, cy], stroke: p.color ?? '#FF9800', strokeWidth: 2 }));
        g.add(new Konva.Line({ points: [cx, cy-r, cx, cy+r], stroke: p.color ?? '#FF9800', strokeWidth: 2 }));
        g.add(this.labelText(el.label, w, h + 2));
        return g;
      }
      case 'pump': {
        const g = new Konva.Group({ x, y });
        const r = Math.min(w,h)/2-2;
        g.add(new Konva.Circle({ x: w/2, y: h/2, radius: r, fill: '#1A2A3A', stroke: p.color ?? '#9C27B0', strokeWidth: 2 }));
        g.add(new Konva.RegularPolygon({ x: w/2, y: h/2, sides: 3, radius: r-6, fill: p.color ?? '#9C27B0', rotation: 90 }));
        g.add(this.labelText(el.label, w, h + 2));
        return g;
      }
      case 'level': {
        // Вертикальный уровнемер: корпус, заливка снизу (.fill) и значение (.value)
        const g = new Konva.Group({ x, y });
        const barH = h - 16;
        g.add(new Konva.Rect({ width: w, height: barH, fill: '#0D1F2D', stroke: '#4FC3F7', strokeWidth: 1, cornerRadius: 3, name: 'bg' }));
        g.add(new Konva.Rect({ x: 2, y: barH - 2, width: w - 4, height: 0, fill: p.color ?? '#1E88E5', cornerRadius: 2, name: 'fill' }));
        g.add(new Konva.Text({ x: 0, y: barH / 2 - 7, width: w, text: '0', fontSize: 13, fill: '#ffffff', align: 'center', fontStyle: 'bold', name: 'value' }));
        g.add(this.labelText(el.label, w, h - 12));
        return g;
      }
      case 'label':
        return new Konva.Text({ x, y, text: p.text ?? el.label, fontSize: p.fontSize ?? 14, fill: p.color ?? '#1a1a1a' });
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
    // Сортируем эталонный сценарий по номеру шага
    this.scenario = [...(this.template.reference_scenario ?? [])]
      .sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
    this.currentStepIdx = 0;
    this.score          = 0;
    this.errors         = 0;
    this.started        = true;
    this.startTime      = new Date();
    this.timerInterval  = setInterval(() => {
      this.elapsed = Math.floor((new Date().getTime() - this.startTime.getTime()) / 1000);
    }, 1000);

    this.attachClickHandlers();
    this.initPhysics();

    // В сценарном режиме сразу подсвечиваем первую цель
    if (this.scenarioMode) this.highlightCurrentTarget();
    this.layer.draw();
  }

  /** Навешивает click-обработчики на все интерактивные элементы холста. */
  private attachClickHandlers(): void {
    this.layer.getChildren().forEach((node: any) => {
      const elType = node.getAttr('elementType');
      if (elType && elType !== 'pipe' && elType !== 'label') {
        node.listening(true);
        node.on('click', () => this.onElementClick(node, {
          type:     elType,
          variable: node.getAttr('variable'),
          id:       node.getAttr('elementId'),
        }));
      }
    });
  }

  onElementClick(node: any, el: any): void {
    if (!this.started || this.finished) return;

    // Без сценария — свободное взаимодействие (прежняя логика)
    if (!this.scenarioMode) {
      this.applyFreeInteraction(node, el);
      return;
    }

    const step = this.scenario[this.currentStepIdx];
    if (el.variable === step.element_id) {
      this.onCorrectClick(node, el, step);
    } else {
      this.onWrongClick(node, el);
    }
    this.layer.draw();
  }

  /** Правильный клик: анимация, лог, переход к следующему шагу. */
  private onCorrectClick(node: any, el: any, step: any): void {
    const newVal = step.expected_value ?? true;
    this.variables[el.variable] = newVal;
    this.updateNodeVisual(node, el.type, newVal, el);
    this.applyRules(el.variable, newVal);
    this.checkBurnerTrigger(el.variable, newVal);

    this.flashNode(node, '#4CAF50');
    this.actionLog.push({
      ts:         new Date().toISOString(),
      element_id: this.getElementLabel(el.variable),
      action:     'click',
      value:      newVal,
      step_index: this.currentStepIdx,
      ok:         true,
    });

    this.score++;
    this.clearHint();
    this.currentStepIdx++;

    if (this.currentStepIdx >= this.scenario.length) {
      // Небольшая задержка, чтобы успела отрисоваться зелёная вспышка
      setTimeout(() => this.finishSimulation(), 600);
    } else {
      this.highlightCurrentTarget();
    }
  }

  /** Неправильный клик: красная вспышка, ошибка в лог. */
  private onWrongClick(node: any, el: any): void {
    this.flashNode(node, '#F44336');
    this.errors++;
    this.actionLog.push({
      ts:         new Date().toISOString(),
      element_id: this.getElementLabel(el.variable),
      action:     'wrong_click',
      value:      false,
      step_index: this.currentStepIdx,
      ok:         false,
    });
  }

  /** Свободный режим (нет reference_scenario). */
  private applyFreeInteraction(node: any, el: any): void {
    const newVal = !(this.variables[el.variable] ?? false);
    this.variables[el.variable] = newVal;
    this.updateNodeVisual(node, el.type, newVal, el);
    this.applyRules(el.variable, newVal);
    this.checkBurnerTrigger(el.variable, newVal);
    this.actionLog.push({
      ts:         new Date().toISOString(),
      element_id: this.getElementLabel(el.variable),
      action:     'click',
      value:      newVal,
      step_index: this.actionLog.length,
    });
    this.layer.draw();
  }

  /** Кратковременная цветная вспышка поверх элемента. */
  private flashNode(node: any, color: string): void {
    const rect = node.getClientRect({ skipTransform: false, relativeTo: this.layer });
    const flash = new Konva.Rect({
      x: rect.x, y: rect.y,
      width: rect.width, height: rect.height,
      fill: color, opacity: 0.45,
      cornerRadius: 4, listening: false,
    });
    this.layer.add(flash);
    this.layer.draw();
    setTimeout(() => { flash.destroy(); this.layer.draw(); }, 500);
  }

  /** Рисует жёлтую пунктирную рамку вокруг текущей целевой ноды. */
  private highlightCurrentTarget(): void {
    this.clearHint();
    if (this.currentStepIdx >= this.scenario.length) return;

    const step = this.scenario[this.currentStepIdx];
    const targetNode = this.layer.find('Group').find((n: any) => n.getAttr('variable') === step.element_id) as any;
    if (!targetNode) return;

    const rect = targetNode.getClientRect({ skipTransform: false, relativeTo: this.layer });
    this.hintShape = new Konva.Rect({
      x: rect.x - 5, y: rect.y - 5,
      width:  rect.width  + 10,
      height: rect.height + 10,
      stroke: '#FFD600', strokeWidth: 2,
      dash: [8, 4], cornerRadius: 6,
      listening: false,
    });
    this.layer.add(this.hintShape);
    this.layer.draw();
  }

  private clearHint(): void {
    if (this.hintShape) { this.hintShape.destroy(); this.hintShape = null; }
  }

  // ── Визуал и правила ─────────────────────────────────────────────────────────

  updateNodeVisual(node: any, type: string, value: boolean, el: any): void {
    const props = node.getAttr('canvasProps') ?? {};
    if (type === 'button' || type === 'lamp') {
      const body = node.findOne('.body');
      if (body) body.fill(value ? (props.color ?? '#4CAF50') : (props.offColor ?? '#555'));
    }
    if (type === 'pump' || type === 'valve') {
      node.getChildren().forEach((c: any) => {
        if (c instanceof Konva.Circle) c.fill(value ? (props.color ?? '#9C27B0') : '#1A2A3A');
      });
    }
  }

  applyRules(changedVar: string, newVal: any): void {
    (this.template?.rules ?? []).forEach((rule: any) => {
      const cond = rule.if;
      if (!cond || cond.variable !== changedVar) return;
      const condMet =
        (cond.op === 'eq'  && newVal === cond.value) ||
        (cond.op === 'neq' && newVal !== cond.value);
      if (condMet && rule.then) {
        rule.then.forEach((act: any) => {
          this.variables[act.variable] = act.set;
          const target = this.layer.find('Group').find((n: any) => n.getAttr('variable') === act.variable) as any;
          if (target) this.updateNodeVisual(target, target.getAttr('elementType'), act.set, {});
        });
      }
    });
  }

  // ── Физика котла ──────────────────────────────────────────────────────────────

  /**
   * Сканирует индикаторы (gauge / sensor / display) на холсте и привязывает
   * каждый к физической величине по ключевым словам в variable/label.
   * Вызывается при старте симуляции, выставляет «холодные» значения.
   */
  private initPhysics(): void {
    this.physicsTargets = [];
    this.physicsState = {};
    this.burnerOn = false;
    const indicatorTypes = ['gauge', 'sensor', 'display', 'level'];

    this.layer.find('Group').forEach((g: any) => {
      const type = g.getAttr('elementType');
      if (!indicatorTypes.includes(type)) return;

      const hay = `${g.getAttr('variable') ?? ''} ${g.getAttr('label') ?? ''}`.toLowerCase();
      let quantity = Object.keys(this.PHYSICS)
        .find(q => this.PHYSICS[q].keys.some(k => hay.includes(k))) ?? '';

      // Фолбэк по типу, если по ключевым словам не определилось
      if (!quantity) {
        quantity = type === 'display' ? 'power'
                 : type === 'sensor'  ? 'temperature'
                 : type === 'level'   ? 'level'
                 : 'pressure';
      }

      const valueText = g.findOne('.value');
      this.physicsTargets.push({ group: g, valueText, quantity });
    });

    // Температура всегда нужна (от неё зависит давление), даже без термометра на схеме
    Object.keys(this.PHYSICS).forEach(q => { this.physicsState[q] = this.PHYSICS[q].min; });

    // Есть ли в схеме орган управления подачей топлива
    this.fuelControlExists = (this.template?.elements ?? []).some((el: any) => {
      const hay = `${el.variable ?? ''} ${el.label ?? ''}`.toLowerCase();
      const isControl = ['valve', 'button', 'pump'].includes(el.type);
      return isControl && this.FUEL_KEYS.some(k => hay.includes(k));
    });

    this.deriveValues();
    this.renderPhysics();
  }

  /**
   * Идёт ли сейчас нагрев. Условие (уровень 2):
   * горелка включена И (нет органа подачи топлива ИЛИ топливо открыто).
   */
  private isHeating(): boolean {
    if (!this.burnerOn) return false;
    if (!this.fuelControlExists) return true;
    return this.isFuelOpen();
  }

  /** Открыта ли хотя бы одна задвижка/кран подачи топлива. */
  private isFuelOpen(): boolean {
    return (this.template?.elements ?? []).some((el: any) => {
      const hay = `${el.variable ?? ''} ${el.label ?? ''}`.toLowerCase();
      const isFuel = this.FUEL_KEYS.some(k => hay.includes(k));
      return isFuel && this.variables[el.variable] === true;
    });
  }

  /**
   * Реагирует на клик по управляющему элементу: пуск/останов горелки.
   * Любой клик по управлению пересчитывает физику (могли открыть топливо).
   */
  private checkBurnerTrigger(variable: string, value: any): void {
    const hay = `${variable ?? ''} ${this.getElementLabel(variable)}`.toLowerCase();
    const isStart = ['burner_start', 'start', 'пуск', 'зажиг', 'розжиг', 'ignite'].some(k => hay.includes(k));
    const isStop  = ['burner_stop', 'stop', 'стоп', 'глуш', 'отключ', 'останов'].some(k => hay.includes(k));

    if (isStart && value) this.burnerOn = true;
    else if (isStop)      this.burnerOn = false;

    // Состояние подачи топлива тоже могло измениться — запускаем пересчёт
    this.startPhysicsLoop();
  }

  private startPhysicsLoop(): void {
    if (this.physicsInterval) return;
    this.physicsInterval = setInterval(() => this.physicsTick(), 100);
  }

  private stopPhysicsLoop(): void {
    if (this.physicsInterval) { clearInterval(this.physicsInterval); this.physicsInterval = null; }
  }

  /** Один шаг физики: интегрирует «приводные» величины, давление вычисляет из температуры. */
  private physicsTick(): void {
    const heating = this.isHeating();
    let allSettled = true;

    Object.keys(this.physicsState).forEach(q => {
      const cfg = this.PHYSICS[q];
      if (cfg.derived) return;                    // вычисляемые величины не интегрируем
      const target = heating ? cfg.max : cfg.min;
      const cur = this.physicsState[q];
      if (Math.abs(cur - target) < 0.005) return;

      allSettled = false;
      const dir = target > cur ? 1 : -1;
      let next = cur + dir * cfg.rate;
      if ((dir > 0 && next > target) || (dir < 0 && next < target)) next = target;
      this.physicsState[q] = next;
    });

    this.deriveValues();
    this.renderPhysics();
    // Всё устаканилось — цикл больше не нужен (запустится снова при следующем клике/триггере)
    if (allSettled) this.stopPhysicsLoop();
  }

  /**
   * Вычисляет производные величины (уровень 1).
   * Давление пара — функция температуры: до точки кипения 0, дальше
   * линейно растёт до рабочего максимума при максимальной температуре.
   */
  private deriveValues(): void {
    const t    = this.physicsState['temperature'] ?? this.PHYSICS['temperature'].min;
    const tMax = this.PHYSICS['temperature'].max;
    const cfg  = this.PHYSICS['pressure'];
    const frac = Math.max(0, (t - this.BOIL_TEMP) / (tMax - this.BOIL_TEMP));
    this.physicsState['pressure'] = Math.min(cfg.max, frac * cfg.max);
  }

  /** Записывает текущие значения физики в индикаторы (текст + заливка уровнемера). */
  private renderPhysics(): void {
    this.physicsTargets.forEach(t => {
      const v = this.physicsState[t.quantity] ?? 0;
      const dec = this.PHYSICS[t.quantity]?.dec ?? 0;
      if (t.valueText) t.valueText.text(v.toFixed(dec));

      // Вертикальный уровнемер — двигаем заливку снизу вверх (значение в %)
      const fill = t.group?.findOne?.('.fill');
      const bg   = t.group?.findOne?.('.bg');
      if (fill && bg) {
        const barH = bg.height();
        const frac = Math.max(0, Math.min(1, v / 100));
        const fh = (barH - 4) * frac;
        fill.height(fh);
        fill.y(barH - 2 - fh);
      }
    });
    this.layer.batchDraw();
  }

  // ── Завершение ───────────────────────────────────────────────────────────────

  finishSimulation(): void {
    // completed: нет сценария (свободный режим) ИЛИ все шаги пройдены
    this.completionStatus = (!this.scenarioMode || this.currentStepIdx >= this.scenario.length)
      ? 'completed'
      : 'incomplete';
    this.clearHint();
    this.finished = true;
    this.started  = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.submitResults();
  }

  submitResults(): void {
    this.submitting = true;
    const payload: any = {
      simulation_id:  +this.simulationId,
      actions_log:    this.actionLog,
      time_spent_sec: this.elapsed,
      errors_count:   this.errors,
      completed:      this.completionStatus === 'completed',
    };
    if (this.enrollmentId) payload.enrollment_id = +this.enrollmentId;

    this.api.post<any>('simulations/submit/', payload).subscribe({
      next: () => {
        this.submitting = false;
        if (this.template?.module) {
          this.api.post(`modules/${this.template.module}/complete/`, { time_spent_sec: this.elapsed }).subscribe();
        }
      },
      error: () => { this.submitting = false; },
    });
  }

  // ── Геттеры / хелперы ────────────────────────────────────────────────────────

  get currentStep(): any     { return this.scenario[this.currentStepIdx] ?? null; }
  get scenarioMode(): boolean { return this.scenario.length > 0; }
  get scorePercent(): number {
    const total = this.score + this.errors;
    return total > 0 ? Math.round(this.score / total * 100) : 0;
  }

  /** Возвращает подпись элемента по его variable-имени из шаблона. */
  getElementLabel(varName: string): string {
    return (this.template?.elements ?? [])
      .find((e: any) => e.variable === varName)?.label ?? varName;
  }

  get elapsedStr(): string {
    const m = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const s = (this.elapsed % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}
