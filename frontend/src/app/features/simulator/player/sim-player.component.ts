import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import Konva from 'konva';

interface ActionLog {
  ts: string;
  element_id: string;
  variable?: string;   // имя переменной элемента (для пошаговой оценки на сервере)
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
  @ViewChild('playerRoot') playerRoot!: ElementRef<HTMLElement>;

  isFullscreen = false;

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
  /** Запущено из конструктора на проверку — «Назад» ведёт обратно в редактор. */
  testMode = false;
  /** Открыто из списка симуляций — «Назад» ведёт к списку. */
  fromList = false;
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

  // ── Аварийная защита (уровень 3) ──────────────────────────────────────────────
  /** Открыт ли сейчас предохранительный клапан (стравливает пар). */
  private safetyOpen = false;
  /** Сработал ли предохранительный клапан хотя бы раз за заход (защёлка для результата). */
  safetyTripped = false;
  /** Активна ли авария прямо сейчас. */
  private alarmActive = false;
  /** Сколько раз возникала аварийная сигнализация за заход. */
  alarmCount = 0;
  /** Давление срабатывания предохранительного клапана (из props), null если клапана нет. */
  private safetyTrigger: number | null = null;
  /** Переменная задвижки сброса пара (null, если её нет в схеме). */
  private steamValveVar: string | null = null;
  private alarmLampNode: any = null;
  /** Рабочая (не аварийная) лампа — горит, когда горелка запущена. */
  private workLampNode: any = null;
  private safetyValveNode: any = null;

  // ── Контроль технологического режима ──────────────────────────────────────────
  /** Рабочее давление, которое котёл обязан набрать для успешного пуска (из props манометра). */
  private workingPressureMin = 6;
  /** Глушили ли горелку («Стоп») во время незавершённого сценария — нарушение режима. */
  prematureStop = false;
  /** Открыли задвижку пара на недостаточном давлении (холодный пуск) — нарушение режима. */
  steamOpenedCold = false;
  /** Пройдён ли процесс «чисто»: пар открыт на рабочем давлении и горелку не глушили рано. */
  processOk = true;

  // ── Связи / поток ──────────────────────────────────────────────────────────────
  /** Линии связей с их данными — для подсветки потока. */
  private connLines: { line: any; conn: any }[] = [];
  /** Связи, сгруппированные по среде (для графовой физики). */
  private mediumConns: Record<string, any[]> = { fuel: [], air: [], steam: [], water: [], none: [] };
  /** Анимация «бегущего» пунктира активных связей. */
  private flowAnim: any = null;

  /** Температура кипения — порог, с которого начинает расти давление пара. */
  private readonly BOIL_TEMP = 100;
  /** Рабочее давление при открытом сбросе пара (безопасный режим). */
  private readonly WORK_PRESSURE = 11;
  /** Давление, к которому стремится система при закрытом сбросе пара (опасный режим). */
  private readonly OVER_PRESSURE = 16;
  /** Температура перегрева (аварийный порог). */
  private readonly OVERHEAT_TEMP = 195;
  /** Ключевые слова органов подачи топлива. */
  private readonly FUEL_KEYS = ['fuel', 'топл', 'газ'];
  /** Ключевые слова задвижки/тракта пара. */
  private readonly STEAM_KEYS = ['steam', 'пар'];
  /** Ключевые слова аварийной лампы. */
  private readonly ALARM_KEYS = ['alarm', 'авар'];

  /**
   * Конфигурация физических величин:
   *  min     — значение в холодном состоянии (нет нагрева)
   *  max     — установившееся рабочее значение при нагреве
   *  rate    — изменение за один тик (100 мс)
   *  dec     — знаков после запятой при выводе
   *  keys    — ключевые слова в variable/label для привязки ноды к величине
   */
  private readonly PHYSICS: Record<string, { min: number; max: number; rate: number; dec: number; keys: string[] }> = {
    temperature: { min: 20, max: 185, rate: 2.2,  dec: 0, keys: ['temp', 'therm', 'термо', 'температ', 't_'] },
    pressure:    { min: 0,  max: 16,  rate: 0.13, dec: 1, keys: ['pressure', 'press', 'давл', 'маномет', 'p_'] },
    power:       { min: 0,  max: 100, rate: 1.4,  dec: 0, keys: ['power', 'мощн', 'pwr'] },
    level:       { min: 55, max: 68,  rate: 0.18, dec: 0, keys: ['level', 'уровен', 'барабан'] },
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
    this.testMode     = this.route.snapshot.queryParamMap.get('test') === '1';
    this.fromList     = this.route.snapshot.queryParamMap.get('from') === 'list';
    this.loadTemplate();
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.stopPhysicsLoop();
    if (this.flowAnim) { this.flowAnim.stop(); this.flowAnim = null; }
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

    // Связи рисуем первыми, чтобы они были под элементами
    this.drawConnections(this.template.connections ?? [], this.template.elements ?? []);
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

  /** Полноэкранный режим рабочей области плеера. */
  toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      this.playerRoot?.nativeElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen = !!document.fullscreenElement;
    // После смены режима пересчитываем размер холста под доступную область.
    setTimeout(() => this.resizeStage(), 60);
  }

  /** Подгоняет размер Konva-сцены под контейнер (для fullscreen и обратно). */
  private resizeStage(): void {
    if (!this.stage || !this.konvaContainer) return;
    const wrap = this.konvaContainer.nativeElement.parentElement as HTMLElement;
    if (this.isFullscreen) {
      this.stage.width(wrap.clientWidth);
      this.stage.height(wrap.clientHeight);
    } else {
      this.stage.width(this.template.canvas_w ?? 1100);
      this.stage.height(this.template.canvas_h ?? 580);
    }
    this.fitToScreen();
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


  /** Рисует связи (трубы) между элементами по их variable. Вызывается до элементов. */
  private drawConnections(connections: any[], elements: any[]): void {
    const byVar: Record<string, any> = {};
    elements.forEach((el: any) => { byVar[el.variable] = el; });
    const center = (el: any) => {
      if (!el) return null;
      const p = el.props ?? {};
      const w = p.width ?? el.width ?? 60;
      const h = p.height ?? el.height ?? 60;
      return { x: (el.x ?? 0) + w / 2, y: (el.y ?? 0) + h / 2 };
    };
    const elbow = (a: any, b: any) => {
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      return dx >= dy
        ? [a.x, a.y, b.x, a.y, b.x, b.y]
        : [a.x, a.y, a.x, b.y, b.x, b.y];
    };
    const mediumColor: Record<string, string> = {
      none: '#90A4AE', steam: '#CFD8DC', water: '#1E88E5', fuel: '#FB8C00', air: '#26C6DA',
    };
    this.connLines = [];
    (connections ?? []).forEach((c: any) => {
      const a = center(byVar[c.from]);
      const b = center(byVar[c.to]);
      if (!a || !b) return;
      const line = new Konva.Line({
        points: elbow(a, b),
        stroke: mediumColor[c.medium ?? 'none'] ?? '#90A4AE',
        strokeWidth: c.width ?? 8,
        lineCap: 'round', lineJoin: 'round', listening: false,
      });
      this.layer.add(line as any);
      this.connLines.push({ line, conn: c });
    });
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
  // Размеры берём из props (истинный размер тела элемента). el.width/height
  // приходят из getClientRect и включают высоту подписи — использовать их для
  // построения нельзя, иначе элемент «уезжает» и деформируется.
  const w = Math.max(p.width ?? el.width ?? 60, 20);   // минимум 20px
  const h = Math.max(p.height ?? el.height ?? 60, 20);  // минимум 20px

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
      case 'safety-valve': {
        // Предохранительный клапан: корпус (.body) и струя сброса пара (.jet, видна при срабатывании)
        const g = new Konva.Group({ x, y });
        const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;
        g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: '#1A2A3A', stroke: p.color ?? '#F44336', strokeWidth: 2, name: 'body' }));
        g.add(new Konva.RegularPolygon({ x: cx, y: cy, sides: 3, radius: r - 7, fill: p.color ?? '#F44336' }));
        // Струя сброса пара — заметный «султан» из нескольких линий вверх от клапана
        const top = cy - r;
        const jet = new Konva.Group({ name: 'jet', visible: false });
        jet.add(new Konva.Line({ points: [cx, top, cx, top - 26], stroke: '#E3F2FD', strokeWidth: 5, lineCap: 'round', dash: [6, 5] }));
        jet.add(new Konva.Line({ points: [cx, top, cx - 12, top - 20], stroke: '#90CAF9', strokeWidth: 4, lineCap: 'round', dash: [6, 5] }));
        jet.add(new Konva.Line({ points: [cx, top, cx + 12, top - 20], stroke: '#90CAF9', strokeWidth: 4, lineCap: 'round', dash: [6, 5] }));
        jet.add(new Konva.Text({ x: cx - 40, y: top - 42, width: 80, text: '⤴ сброс пара', fontSize: 10, fill: '#E3F2FD', align: 'center', fontStyle: 'bold' }));
        g.add(jet);
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
      case 'boiler': {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: w, height: h, fill: '#2B3A47', stroke: p.color ?? '#5A6B7A', strokeWidth: 2, cornerRadius: 16 }));
        const wl = Math.round(h * 0.5);
        g.add(new Konva.Rect({ x: 6, y: wl, width: w - 12, height: h - wl - 22, fill: '#15466b', opacity: 0.55, cornerRadius: 4 }));
        g.add(new Konva.Line({ points: [8, wl, w - 8, wl], stroke: '#4FC3F7', strokeWidth: 1.5, dash: [7, 4] }));
        g.add(new Konva.Rect({ x: 12, y: h - 20, width: w - 24, height: 12, fill: '#5D2E12', cornerRadius: 5 }));
        g.add(new Konva.Text({ x: 0, y: 14, width: w, text: el.label, fontSize: 14, fill: '#CFD8DC', align: 'center', fontStyle: 'bold' }));
        return g;
      }
      case 'label':
        return new Konva.Text({ x, y, text: p.text ?? el.label, fontSize: p.fontSize ?? 14, fill: p.color ?? '#1a1a1a' });
      case 'panel': {
        // Декоративная подложка-щит: цветной прямоугольник позади органов управления.
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({
          width: w, height: h, fill: p.color ?? '#26323F',
          stroke: p.border ?? '#3D4D5E', strokeWidth: 2, cornerRadius: 12,
        }));
        if (el.label) {
          g.add(new Konva.Text({ x: 14, y: 10, text: el.label, fontSize: 12,
            fill: p.titleColor ?? '#9FB3C8', fontStyle: 'bold' }));
        }
        return g;
      }
      default: {
        const g = new Konva.Group({ x, y });
        g.add(new Konva.Rect({ width: w, height: h, fill: '#1A2A3A', stroke: '#607D8B', strokeWidth: 1, cornerRadius: 4 }));
        g.add(new Konva.Text({ x: 0, y: h/2-9, width: w, text: el.label, fontSize: 12, fill: '#4FC3F7', align: 'center' }));
        return g;
      }
    }
  }

  // ── Gameplay ─────────────────────────────────────────────────────────────────

  /** Типы элементов-органов управления (только по ним возможно взаимодействие). */
  private readonly CONTROL_TYPES = ['button', 'valve', 'pump', 'switch', 'toggle'];

  /** Является ли элемент органом управления (по variable элемента шаблона). */
  private isControlVar(variable: string): boolean {
    const el = (this.template?.elements ?? []).find((e: any) => e.variable === variable);
    return !!el && this.CONTROL_TYPES.includes(el.type);
  }

  /** Входит ли элемент в эталонный сценарий (как один из его шагов). */
  private isScenarioVar(variable: string): boolean {
    return this.scenario.some((s: any) => s.element_id === variable);
  }

  startSimulation(): void {
    // Сортируем сценарий по шагам и оставляем только шаги по органам управления.
    // Клики по индикаторам (манометр, уровнемер, дисплей) смысловой нагрузки не несут.
    this.scenario = [...(this.template.reference_scenario ?? [])]
      .sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
      .filter(step => this.isControlVar(step.element_id));
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

  /**
   * Навешивает click-обработчики только на органы управления.
   * Индикаторы (gauge / level / display / sensor / safety-valve / lamp) не слушают
   * клики вовсе — клик по ним не считается ни шагом, ни ошибкой.
   */
  private attachClickHandlers(): void {
    this.layer.getChildren().forEach((node: any) => {
      const elType = node.getAttr('elementType');
      const interactive = this.CONTROL_TYPES.includes(elType);
      node.listening(interactive);
      if (interactive) {
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
    } else if (this.isScenarioVar(el.variable)) {
      // Управляющий элемент, который входит в сценарий, но нажат не по порядку — ошибка.
      this.onWrongClick(node, el);
    } else {
      // Вспомогательный орган управления (например, задвижка сброса пара), которого
      // нет в эталонном сценарии. Им можно свободно управлять для регулирования режима —
      // это влияет на физику, но не считается шагом и не штрафуется как ошибка.
      // Исключение: «Стоп горелки» до завершения пуска — нарушение технологического режима.
      if (this.isStopControl(el.variable) && this.currentStepIdx < this.scenario.length) {
        this.prematureStop = true;
        this.errors++;
        this.flashNode(node, '#F44336');
        this.actionLog.push({
          ts:         new Date().toISOString(),
          element_id: this.getElementLabel(el.variable),
          action:     'premature_stop',
          value:      false,
          step_index: this.currentStepIdx,
          ok:         false,
        });
      }
      this.applyFreeInteraction(node, el);
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

    // Открытие задвижки пара на недостаточном давлении — нарушение режима (холодный пуск).
    if (el.variable === this.steamValveVar && newVal === true
        && (this.physicsState['pressure'] ?? 0) < this.workingPressureMin) {
      this.steamOpenedCold = true;
    }

    this.flashNode(node, '#4CAF50');
    this.actionLog.push({
      ts:         new Date().toISOString(),
      element_id: this.getElementLabel(el.variable),
      variable:   el.variable,
      action:     'click',
      value:      newVal,
      step_index: this.currentStepIdx,
      ok:         true,
    });

    // Кнопка — без фиксации: после регистрации нажатия возвращаем в исходное.
    if (el.type === 'button') this.resetMomentary(node, el);

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
    // Кнопка — моментального действия (импульс), а не переключатель с фиксацией.
    const isButton = el.type === 'button';
    const newVal = isButton ? true : !(this.variables[el.variable] ?? false);
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
    if (isButton) this.resetMomentary(node, el);
    this.layer.draw();
  }

  /** Возврат кнопки в отжатое состояние (без записи в лог) — имитация кнопки без фиксации. */
  private resetMomentary(node: any, el: any): void {
    setTimeout(() => {
      this.variables[el.variable] = false;
      this.updateNodeVisual(node, 'button', false, el);
      this.layer.draw();
    }, 250);
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
    if (type === 'valve') {
      // Открыта — заливка цветом; закрыта — прозрачная (как при создании, не тёмная).
      node.getChildren().forEach((c: any) => {
        if (c instanceof Konva.Circle) c.fill(value ? (props.color ?? '#FF9800') : 'transparent');
      });
    }
    if (type === 'pump') {
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
    // Сброс аварийной защиты
    this.safetyOpen = false;
    this.safetyTripped = false;
    this.alarmActive = false;
    this.alarmCount = 0;
    this.safetyTrigger = null;
    this.steamValveVar = null;
    this.alarmLampNode = null;
    this.workLampNode = null;
    this.safetyValveNode = null;
    this.workingPressureMin = 6;
    this.prematureStop = false;
    this.steamOpenedCold = false;
    this.processOk = true;
    const indicatorTypes = ['gauge', 'sensor', 'display', 'level'];

    this.layer.find('Group').forEach((g: any) => {
      const type = g.getAttr('elementType');
      const hay = `${g.getAttr('variable') ?? ''} ${g.getAttr('label') ?? ''}`.toLowerCase();

      // Предохранительный клапан / аварийная лампа — для уровня 3
      if (type === 'safety-valve') {
        this.safetyValveNode = g;
        this.safetyTrigger = (g.getAttr('canvasProps') ?? {}).triggerPressure ?? 14;
      }
      if (type === 'lamp') {
        if (this.ALARM_KEYS.some(k => hay.includes(k))) {
          this.alarmLampNode = g;            // лампа аварии
        } else if (!this.workLampNode) {
          this.workLampNode = g;             // первая «рабочая» лампа — индикация горелки
        }
      }

      if (!indicatorTypes.includes(type)) return;

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

      // Рабочий порог давления берём из манометра (normalMin), если задан
      if (quantity === 'pressure') {
        const nm = (g.getAttr('canvasProps') ?? {}).normalMin;
        if (typeof nm === 'number') this.workingPressureMin = nm;
      }
    });

    // Температура всегда нужна (от неё зависит давление), даже без термометра на схеме
    Object.keys(this.PHYSICS).forEach(q => { this.physicsState[q] = this.PHYSICS[q].min; });

    // Есть ли в схеме орган управления подачей топлива
    this.fuelControlExists = (this.template?.elements ?? []).some((el: any) => {
      const hay = `${el.variable ?? ''} ${el.label ?? ''}`.toLowerCase();
      const isControl = ['valve', 'button', 'pump'].includes(el.type);
      return isControl && this.FUEL_KEYS.some(k => hay.includes(k));
    });

    // Задвижка сброса пара (открыта → давление в норме, закрыта → растёт)
    const steamEl = (this.template?.elements ?? []).find((el: any) => {
      const hay = `${el.variable ?? ''} ${el.label ?? ''}`.toLowerCase();
      return el.type === 'valve' && this.STEAM_KEYS.some(k => hay.includes(k));
    });
    this.steamValveVar = steamEl?.variable ?? null;

    // Группируем связи по среде (для графовой физики)
    this.mediumConns = { fuel: [], air: [], steam: [], water: [], none: [] };
    (this.template?.connections ?? []).forEach((c: any) => {
      const m = c.medium ?? 'none';
      (this.mediumConns[m] ??= []).push(c);
    });

    this.setAlarmVisual(false);
    this.setSafetyVisual(false);
    this.renderPhysics();
    this.updateConnectionFlow();
  }

  /**
   * Идёт ли сейчас нагрев. Условие (уровень 2):
   * горелка включена И (нет органа подачи топлива ИЛИ топливо открыто).
   */
  private isHeating(): boolean {
    if (!this.burnerOn) return false;
    // Графовая логика: если заданы связи топлива/воздуха — требуем доставку по ним;
    // иначе откат на старую keyword-логику (sim без связей продолжает работать).
    const fuelOk = (this.mediumConns['fuel']?.length)
      ? this.mediumDelivered('fuel')
      : (this.fuelControlExists ? this.isFuelOpen() : true);
    const airOk = (this.mediumConns['air']?.length)
      ? this.mediumDelivered('air')
      : true;
    return fuelOk && airOk;
  }

  /** Открыта ли хотя бы одна задвижка/кран подачи топлива. */
  private isFuelOpen(): boolean {
    return (this.template?.elements ?? []).some((el: any) => {
      const hay = `${el.variable ?? ''} ${el.label ?? ''}`.toLowerCase();
      const isFuel = this.FUEL_KEYS.some(k => hay.includes(k));
      return isFuel && this.variables[el.variable] === true;
    });
  }

  // ── Графовая физика и подсветка потока ─────────────────────────────────────────

  /** Открыты ли все управляющие концы связи (если их нет — связь считается открытой). */
  private connControlsOpen(conn: any): boolean {
    return [conn.from, conn.to]
      .filter(v => this.isControlVar(v))
      .every(v => this.variables[v] === true);
  }

  /** Доходит ли среда до котла: есть хотя бы один открытый путь данной среды. */
  private mediumDelivered(medium: string): boolean {
    return (this.mediumConns[medium] ?? []).some(c => this.connControlsOpen(c));
  }

  /** Активна ли связь (среда идёт) — для подсветки потока. */
  private connectionActive(conn: any): boolean {
    const medium = conn.medium ?? 'none';
    if (medium === 'none') return false;
    if (!this.connControlsOpen(conn)) return false;
    if (medium === 'steam') return (this.physicsState['pressure'] ?? 0) > 0.5;
    return true;   // fuel / air / water: открыт клапан → течёт
  }

  /** Перекрашивает связи по состоянию потока и запускает/останавливает анимацию пунктира. */
  private updateConnectionFlow(): void {
    let anyActive = false;
    this.connLines.forEach(({ line, conn }) => {
      const active = this.connectionActive(conn);
      const hasMedium = conn.medium && conn.medium !== 'none';
      if (active) {
        line.opacity(1);
        line.dash([14, 10]);
        anyActive = true;
      } else {
        line.opacity(hasMedium ? 0.4 : 0.8);
        line.dash([]);
        line.dashOffset(0);
      }
    });
    this.layer.batchDraw();

    if (anyActive && !this.flowAnim) {
      this.flowAnim = new Konva.Animation((frame: any) => {
        const off = -((frame?.time ?? 0) / 28) % 24;
        this.connLines.forEach(({ line, conn }) => {
          if (this.connectionActive(conn)) line.dashOffset(off);
        });
      }, this.layer);
      this.flowAnim.start();
    } else if (!anyActive && this.flowAnim) {
      this.flowAnim.stop();
      this.flowAnim = null;
    }
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

    // Рабочая лампа отражает состояние горелки
    this.setWorkLampVisual(this.burnerOn);

    // Поток по связям мог измениться (открыли/закрыли задвижку)
    this.updateConnectionFlow();

    // Состояние подачи топлива тоже могло измениться — запускаем пересчёт
    this.startPhysicsLoop();
  }

  /** Является ли орган управления кнопкой «Стоп/глушение горелки». */
  private isStopControl(variable: string): boolean {
    const hay = `${variable ?? ''} ${this.getElementLabel(variable)}`.toLowerCase();
    return ['burner_stop', 'stop', 'стоп', 'глуш', 'отключ', 'останов'].some(k => hay.includes(k));
  }

  private startPhysicsLoop(): void {
    if (this.physicsInterval) return;
    this.physicsInterval = setInterval(() => this.physicsTick(), 100);
  }

  private stopPhysicsLoop(): void {
    if (this.physicsInterval) { clearInterval(this.physicsInterval); this.physicsInterval = null; }
  }

  /** Один шаг физики: интегрирует приводные величины, считает давление и аварийную защиту. */
  private physicsTick(): void {
    const heating = this.isHeating();
    let allSettled = true;

    // 1. Температура, мощность, уровень — плавно к цели
    ['temperature', 'power', 'level'].forEach(q => {
      const cfg = this.PHYSICS[q];
      const target = heating ? cfg.max : cfg.min;
      const cur = this.physicsState[q];
      if (Math.abs(cur - target) < 0.005) return;

      allSettled = false;
      const dir = target > cur ? 1 : -1;
      let next = cur + dir * cfg.rate;
      if ((dir > 0 && next > target) || (dir < 0 && next < target)) next = target;
      this.physicsState[q] = next;
    });

    // 2. Давление (зависит от t° и состояния сброса пара)
    if (this.updatePressure(heating)) allSettled = false;

    // 3. Аварийная защита: предохранительный клапан + сигнализация
    if (this.updateSafety()) allSettled = false;

    // 4. Поток пара зависит от давления — обновляем подсветку связей
    this.updateConnectionFlow();

    this.renderPhysics();
    // Всё устаканилось — цикл больше не нужен (запустится снова при следующем клике/триггере)
    if (allSettled) this.stopPhysicsLoop();
  }

  /**
   * Давление пара (уровень 1 + 3).
   * Базовое давление растёт с температурой выше точки кипения. При открытом сбросе
   * пара система держит рабочее давление; при закрытом — стремится к опасному.
   * Открытый предохранительный клапан стравливает давление.
   * @returns false, если давление достигло цели (устаканилось).
   */
  private updatePressure(heating: boolean): boolean {
    const tMax = this.PHYSICS['temperature'].max;
    const t    = this.physicsState['temperature'];
    const frac = Math.max(0, (t - this.BOIL_TEMP) / (tMax - this.BOIL_TEMP));

    // Давление растёт только при активном нагреве: горелка генерирует пар.
    // Без нагрева пар не вырабатывается — давление спадает независимо от того,
    // открыта задвижка пара или нет (это и позволяет штатно заглушить котёл).
    const base = !heating
      ? 0
      : (this.isSteamOutletOpen() ? this.WORK_PRESSURE : this.OVER_PRESSURE);
    let target = frac * base;
    // Стравливание предохранительным клапаном
    if (this.safetyOpen && this.safetyTrigger != null) {
      target = Math.min(target, this.safetyTrigger - 2);
    }

    const cfg = this.PHYSICS['pressure'];
    const cur = this.physicsState['pressure'];
    if (Math.abs(cur - target) < 0.005) return false;

    // При сбросе давление падает быстрее, чем растёт
    const rate = (target < cur) ? cfg.rate * 1.6 : cfg.rate;
    const dir  = target > cur ? 1 : -1;
    let next = cur + dir * rate;
    if ((dir > 0 && next > target) || (dir < 0 && next < target)) next = target;
    this.physicsState['pressure'] = next;
    return true;
  }

  /** Открыт ли тракт сброса пара (по графу, иначе по задвижке пара, иначе открыт). */
  private isSteamOutletOpen(): boolean {
    if (this.mediumConns['steam']?.length) return this.mediumDelivered('steam');
    if (!this.steamValveVar) return true;
    return this.variables[this.steamValveVar] === true;
  }

  /**
   * Предохранительный клапан и аварийная сигнализация (уровень 3).
   * Клапан открывается при достижении порога, закрывается с гистерезисом.
   * Авария — при срабатывании клапана, опасном давлении или перегреве.
   * @returns true, если защита в активном (неустановившемся) состоянии.
   */
  private updateSafety(): boolean {
    const p = this.physicsState['pressure'];
    const trig = this.safetyTrigger;

    // Предохранительный клапан с гистерезисом 2 бар
    if (trig != null) {
      if (!this.safetyOpen && p >= trig) {
        this.safetyOpen = true;
        this.safetyTripped = true;
        this.setSafetyVisual(true);
      } else if (this.safetyOpen && p <= trig - 2) {
        this.safetyOpen = false;
        this.setSafetyVisual(false);
      }
    }

    // Аварийная сигнализация
    const overpressure = trig != null && p >= trig - 1;
    const overheat     = this.physicsState['temperature'] >= this.OVERHEAT_TEMP;
    const alarm = this.safetyOpen || overpressure || overheat;

    if (alarm !== this.alarmActive) {
      this.alarmActive = alarm;
      if (alarm) this.alarmCount++;
      this.setAlarmVisual(alarm);
    }

    return this.safetyOpen || alarm;
  }

  /** Подсветка аварийной лампы. */
  private setAlarmVisual(on: boolean): void {
    const body = this.alarmLampNode?.findOne?.('.body');
    if (!body) return;
    const props = this.alarmLampNode.getAttr('canvasProps') ?? {};
    body.fill(on ? (props.color ?? '#F44336') : (props.offColor ?? '#333'));
  }

  /** Подсветка рабочей лампы (горелка работает). */
  private setWorkLampVisual(on: boolean): void {
    const body = this.workLampNode?.findOne?.('.body');
    if (!body) return;
    const props = this.workLampNode.getAttr('canvasProps') ?? {};
    body.fill(on ? (props.color ?? '#4CAF50') : (props.offColor ?? '#333'));
  }

  /** Визуализация срабатывания предохранительного клапана (струя сброса). */
  private setSafetyVisual(open: boolean): void {
    const node = this.safetyValveNode;
    if (!node) return;
    const props = node.getAttr('canvasProps') ?? {};
    const body = node.findOne('.body');
    const jet  = node.findOne('.jet');
    if (body) body.fill(open ? (props.color ?? '#F44336') : '#1A2A3A');
    if (jet)  jet.visible(open);
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
    // Технологический режим пройден «чисто», если задвижку пара открыли на рабочем
    // давлении и горелку не глушили вне процедуры. Проверка по моменту открытия пара —
    // чтобы штатный останов (с падением давления в конце) не считался нарушением.
    this.processOk = !this.steamOpenedCold && !this.prematureStop;

    // completed: нет сценария (свободный режим) ИЛИ все шаги пройдены
    this.completionStatus = (!this.scenarioMode || this.currentStepIdx >= this.scenario.length)
      ? 'completed'
      : 'incomplete';
    this.clearHint();
    this.finished = true;
    this.started  = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.stopPhysicsLoop();
    this.submitResults();
  }

  submitResults(): void {
    // Тест-прогон из конструктора не сохраняем — это проверка, а не попытка студента.
    if (this.testMode) { this.submitting = false; return; }

    this.submitting = true;
    const payload: any = {
      simulation_id:  +this.simulationId,
      actions_log:    this.actionLog,
      time_spent_sec: this.elapsed,
      errors_count:   this.errors,
      completed:      this.completionStatus === 'completed',
      safety_tripped: this.safetyTripped,
      alarm_count:    this.alarmCount,
      process_ok:     this.processOk,
    };
    if (this.enrollmentId) payload.enrollment_id = +this.enrollmentId;

    this.api.post<any>('simulations/submit/', payload).subscribe({
      next: () => {
        this.submitting = false;
        // Модуль засчитываем завершённым только при успешном прохождении:
        // все шаги сценария пройдены, без аварийной защиты и нарушения режима.
        const passed = this.completionStatus === 'completed' && !this.safetyTripped && this.processOk;
        if (this.template?.module && passed) {
          this.api.post(`modules/${this.template.module}/complete/`, { time_spent_sec: this.elapsed }).subscribe();
        }
      },
      error: () => { this.submitting = false; },
    });
  }

  // ── Геттеры / хелперы ────────────────────────────────────────────────────────

  get currentStep(): any     { return this.scenario[this.currentStepIdx] ?? null; }
  get scenarioMode(): boolean { return this.scenario.length > 0; }
  /** Активна ли аварийная сигнализация прямо сейчас (для индикатора в шапке). */
  get hazardActive(): boolean { return this.alarmActive; }
  /** Пояснение к текущему шагу: зачем выполняется действие (если задано в сценарии). */
  get currentStepDescription(): string {
    const s = this.currentStep;
    return s?.description ?? s?.hint ?? '';
  }
  get scorePercent(): number {
    const total = this.score + this.errors;
    return total > 0 ? Math.round(this.score / total * 100) : 0;
  }

  // Штрафы должны совпадать с backend (SimulationSubmitSerializer):
  // при срабатывании защиты балл умножается на коэффициент и за каждую аварию вычитается фикс.
  private readonly SAFETY_TRIP_FACTOR = 0.5;
  private readonly ALARM_PENALTY      = 0.5;
  /** Множитель балла при нарушении технологического режима (не вышел на давление / глушил рано). */
  private readonly PROCESS_VIOLATION_FACTOR = 0.5;
  /** Вычет балла за каждое ошибочное действие (неверный клик). */
  private readonly ERROR_PENALTY = 1;

  /** Было ли нарушение режима (для баннера и заголовка результата). */
  get hasViolation(): boolean { return this.safetyTripped || !this.processOk; }

  /** Итоговый балл с учётом штрафов за ошибки, аварию и нарушение режима (как считает сервер). */
  get displayScore(): number {
    let s = this.score - this.errors * this.ERROR_PENALTY;
    if (this.safetyTripped) s = s * this.SAFETY_TRIP_FACTOR - this.alarmCount * this.ALARM_PENALTY;
    if (!this.processOk)    s = s * this.PROCESS_VIOLATION_FACTOR;
    return Math.round(Math.max(0, s) * 10) / 10;
  }

  /** Итоговый процент с учётом штрафа (знаменатель — число шагов сценария). */
  get displayScorePercent(): number {
    const max = this.scenario.length;
    return max > 0 ? Math.round(this.displayScore / max * 100) : 0;
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
