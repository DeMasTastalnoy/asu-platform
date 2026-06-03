import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import Konva from 'konva';

interface LibraryElement {
  id: string;
  name: string;
  category: string;
  type: string;
  icon: string;
  default_properties: any;
}

interface CanvasElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  variable: string;
  label: string;
  props: any;
}

/** Шаг эталонного сценария (он же подсказка-гид для студента в плеере). */
interface ScenarioStep {
  step: number;
  element_id: string;       // == variable элемента на холсте
  expected_value: boolean;  // целевое состояние (ВКЛ/ВЫКЛ)
  description: string;       // пояснение «зачем» — показывается в плеере
}

/** Действие триггера: установить переменной целевое значение. */
interface RuleAction {
  variable: string;
  set: boolean;
}

/** Триггер (правило): когда переменная-источник принимает значение — выполнить действия. */
interface Rule {
  if:   { variable: string; op: 'eq' | 'neq'; value: boolean };
  then: RuleAction[];
}

/** Связь (труба/провод) между двумя элементами по их variable. */
interface Connection {
  from:    string;
  to:      string;
  medium?: string;   // 'none' | 'steam' | 'water' | 'fuel' | 'air' — задаёт цвет
  width?:  number;   // толщина трубы (px)
}

@Component({
  selector: 'app-sim-constructor',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './sim-constructor.component.html',
  styleUrl: './sim-constructor.component.scss',
})
export class SimConstructorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('konvaContainer') konvaContainer!: ElementRef;

  // Konva objects
  stage!: Konva.Stage;
  layer!: Konva.Layer;
  transformer!: Konva.Transformer;

  // State
  libraryElements: LibraryElement[] = [];
  libraryCategories: string[] = [];
  activeCategory = 'controls';
  activeLibrarySet = 'boiler';

  readonly LIBRARY_SETS = [
//     { value: 'universal',    label: 'Универсальная' },
    { value: 'boiler',       label: 'Котельная' },
    { value: 'pump_station', label: 'Насосная станция' },
    { value: 'substation',   label: 'Электроподстанция' },
  ];

//   private readonly FALLBACK_LIBRARY: LibraryElement[] = [
//     { id: 'btn-start', name: 'Кнопка ПУСК', category: 'controls', type: 'button',
//       icon: '▶', default_properties: { color: '#4CAF50', offColor: '#555', width: 60, height: 60, shape: 'circle' } },
//     { id: 'btn-stop', name: 'Кнопка СТОП', category: 'controls', type: 'button',
//       icon: '■', default_properties: { color: '#F44336', offColor: '#555', width: 60, height: 60, shape: 'circle' } },
//     { id: 'switch', name: 'Переключатель', category: 'controls', type: 'switch',
//       icon: '⬛', default_properties: { color: '#2196F3', width: 80, height: 36 } },
//     { id: 'input-num', name: 'Ввод числа', category: 'controls', type: 'input',
//       icon: '🔢', default_properties: { width: 100, height: 36, min: 0, max: 100 } },
//     { id: 'lamp-green', name: 'Лампа зелёная', category: 'indicators', type: 'lamp',
//       icon: '💡', default_properties: { color: '#4CAF50', offColor: '#333', width: 30, height: 30 } },
//     { id: 'lamp-red', name: 'Лампа красная', category: 'indicators', type: 'lamp',
//       icon: '🔴', default_properties: { color: '#F44336', offColor: '#333', width: 30, height: 30 } },
//     { id: 'gauge', name: 'Манометр', category: 'indicators', type: 'gauge',
//       icon: '📊', default_properties: { min: 0, max: 10, unit: 'бар', width: 80, height: 80 } },
//     { id: 'display', name: 'Дисплей', category: 'indicators', type: 'display',
//       icon: '🖥', default_properties: { width: 120, height: 50, fontSize: 18 } },
//     { id: 'pipe-h', name: 'Труба гор.', category: 'pipes', type: 'pipe',
//       icon: '━', default_properties: { width: 120, height: 12, color: '#1E88E5', direction: 'horizontal' } },
//     { id: 'pipe-v', name: 'Труба верт.', category: 'pipes', type: 'pipe',
//       icon: '┃', default_properties: { width: 12, height: 120, color: '#1E88E5', direction: 'vertical' } },
//     { id: 'pipe-corner', name: 'Отвод', category: 'pipes', type: 'pipe-corner',
//       icon: '┘', default_properties: { width: 40, height: 40, color: '#1E88E5' } },
//     { id: 'valve', name: 'Задвижка', category: 'valves', type: 'valve',
//       icon: '⊠', default_properties: { color: '#FF9800', width: 40, height: 40 } },
//     { id: 'pump', name: 'Насос', category: 'valves', type: 'pump',
//       icon: '⊙', default_properties: { color: '#9C27B0', width: 60, height: 60 } },
//     { id: 'sensor-temp', name: 'Датчик темп.', category: 'sensors', type: 'sensor',
//       icon: '🌡', default_properties: { unit: '°C', min: -50, max: 150, width: 60, height: 70 } },
//     { id: 'sensor-press', name: 'Датчик давл.', category: 'sensors', type: 'sensor',
//       icon: '⊕', default_properties: { unit: 'бар', min: 0, max: 16, width: 60, height: 70 } },
//     { id: 'label', name: 'Подпись', category: 'sensors', type: 'label',
//       icon: 'T', default_properties: { text: 'Метка', fontSize: 14, color: '#607D8B', width: 100, height: 30 } },
//   ];
  selectedNode: Konva.Node | null = null;
  selectedElement: CanvasElement | null = null;

  // ── Эталонный сценарий ────────────────────────────────────────────────────────
  /** Типы элементов-органов управления — только их можно ставить в шаги сценария. */
  private readonly CONTROL_TYPES = ['button', 'valve', 'pump', 'switch', 'toggle'];
  scenario: ScenarioStep[] = [];
  /** Выбранный в выпадающем списке элемент для добавления нового шага. */
  newStepVar = '';
  /** Триггеры (правила) шаблона — редактируются и сохраняются. */
  rules: Rule[] = [];
  /** Связи (трубы) между элементами. */
  connections: Connection[] = [];
  /** Среды трубопровода: значение → подпись и цвет. */
  readonly MEDIA = [
    { value: 'none',  label: '— без среды —', color: '#90A4AE' },
    { value: 'steam', label: 'Пар',          color: '#CFD8DC' },
    { value: 'water', label: 'Вода',         color: '#1E88E5' },
    { value: 'fuel',  label: 'Топливо',      color: '#FB8C00' },
    { value: 'air',   label: 'Воздух',       color: '#26C6DA' },
  ];
  /** Толщина трубы по умолчанию (средняя). */
  readonly DEFAULT_CONN_WIDTH = 8;
  /** Включён ли режим связывания (клик по двум элементам создаёт связь). */
  connectMode = false;
  /** Первый выбранный элемент в режиме связывания (variable). */
  connectFrom: string | null = null;
  /** Активная вкладка правой панели логики. */
  logicTab: 'scenario' | 'rules' | 'connections' = 'scenario';

  // Simulation meta
  simName = 'Новая симуляция';
  simDescription = '';
  moduleId: string | null = null;
  templateId: string | null = null;
  saving = false;
  saved = false;
  /** Текущий статус шаблона: опубликован ли он. */
  published = false;
  user: any;

  // Canvas dimensions
  CANVAS_W = 1100;
  CANVAS_H = 580;

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.moduleId = this.route.snapshot.queryParamMap.get('module');
    this.templateId = this.route.snapshot.paramMap.get('id');
    this.loadLibrary();
    if (this.templateId) this.loadTemplate();
  }

  ngAfterViewInit(): void {
    this.initKonva();
  }

  ngOnDestroy(): void {
    if (this.stage) this.stage.destroy();
  }

  // ── Konva init ──────────────────────────────────────────────────────────────

  initKonva(): void {
    this.stage = new Konva.Stage({
      container: this.konvaContainer.nativeElement,
      width: this.CANVAS_W,
      height: this.CANVAS_H,
      draggable: true,
    });

    this.layer = new Konva.Layer();
    this.stage.add(this.layer);

    // Grid background
    const gridLayer = new Konva.Layer();
    this.drawGrid(gridLayer);
    this.stage.add(gridLayer);
    gridLayer.moveToBottom();

    // Transformer
    this.transformer = new Konva.Transformer({
      rotateEnabled: false,
      boundBoxFunc: (oldBox, newBox) => {
        if (newBox.width < 20 || newBox.height < 20) return oldBox;
        return newBox;
      },
    });
    this.layer.add(this.transformer);

    // Растягивание рамкой → пересчёт масштаба в размеры (props), затем перерисовка
    this.transformer.on('transformend', () => this.applyTransform());

    // Click on empty → deselect
    this.stage.on('click', (e) => {
      if (e.target === this.stage) {
        this.transformer.nodes([]);
        this.selectedNode = null;
        this.selectedElement = null;
        this.layer.draw();
      }
    });

    // Drop from library
    const container = this.konvaContainer.nativeElement;
    container.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
    container.addEventListener('drop', (e: DragEvent) => this.onDrop(e));

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

    if (vw > 0 && vh > 0) {
      const scale = Math.max(this.ZOOM_MIN, Math.min(this.ZOOM_MAX, Math.min(vw / this.CANVAS_W, vh / this.CANVAS_H)));
      this.stage.scale({ x: scale, y: scale });
      this.stage.position({
        x: Math.max(0, (vw - this.CANVAS_W * scale) / 2),
        y: Math.max(0, (vh - this.CANVAS_H * scale) / 2),
      });
    } else {
      this.stage.scale({ x: 1, y: 1 });
      this.stage.position({ x: 0, y: 0 });
    }
  }

  drawGrid(layer: Konva.Layer): void {
    const step = 20;
    // Сетку рисуем с большим запасом за пределами холста, чтобы при
    // прокрутке/масштабировании поле оставалось разлинованным, а не обрывалось.
    const margin = 2000;
    const x0 = -margin, x1 = this.CANVAS_W + margin;
    const y0 = -margin, y1 = this.CANVAS_H + margin;
    for (let x = x0; x <= x1; x += step) {
      layer.add(new Konva.Line({ points: [x, y0, x, y1], stroke: '#e8ecf0', strokeWidth: 0.5 }));
    }
    for (let y = y0; y <= y1; y += step) {
      layer.add(new Konva.Line({ points: [x0, y, x1, y], stroke: '#e8ecf0', strokeWidth: 0.5 }));
    }
  }

  // ── Library ─────────────────────────────────────────────────────────────────

  loadLibrary(): void {
  this.api.get<any>(`simulations/elements/?library_set=${this.activeLibrarySet}`)
    .subscribe({
      next: (response) => {
        const elements = Array.isArray(response) ? response : response.results ?? [];
        if (elements.length > 0) {
          this.libraryElements = elements;
          this.libraryCategories = [...new Set<string>(elements.map((e: any) => e.category as string))];
          if (!this.libraryCategories.includes(this.activeCategory)) {
            this.activeCategory = this.libraryCategories[0] ?? 'controls';
          }
        }
      },
    });
}

  onLibrarySetChange(set: string): void {
    this.activeLibrarySet = set;
    this.loadLibrary();
  }

  getFilteredElements(): LibraryElement[] {
    return this.libraryElements.filter(e => e.category === this.activeCategory);
  }

  getCategoryLabel(cat: string): string {
    const map: Record<string, string> = {
      equipment: 'Оборудование',
      controls: 'Управление', indicators: 'Индикаторы',
      pipes: 'Трубопровод (декор)', valves: 'Арматура', sensors: 'Датчики',
    };
    return map[cat] ?? cat;
  }

  onDragStart(e: DragEvent, el: LibraryElement): void {
    e.dataTransfer!.setData('elementId', el.id);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    const id = e.dataTransfer!.getData('elementId');
    const libEl = this.libraryElements.find(el => el.id === id);
    if (!libEl) return;

    const rect  = this.konvaContainer.nativeElement.getBoundingClientRect();
    const scale = this.stage.scaleX();
    const pos   = this.stage.position();

    // Перевод экранных координат в логические координаты холста
    const x = (e.clientX - rect.left - pos.x) / scale;
    const y = (e.clientY - rect.top  - pos.y) / scale;

    this.addElementToCanvas(libEl, x, y);
  }

  // ── Canvas elements ─────────────────────────────────────────────────────────

  /** Монотонный счётчик — гарантирует уникальность id даже при создании пачкой. */
  private elementSeq = 0;

  /**
   * Добавляет элемент на холст. При загрузке шаблона передаётся `override`
   * с сохранёнными id/variable/label/props — тогда элемент восстанавливается
   * точь-в-точь (а размеры берутся из сохранённых props, а не из библиотеки).
   */
  addElementToCanvas(
    libEl: LibraryElement,
    x: number,
    y: number,
    override?: { id?: string; variable?: string; label?: string; props?: any },
  ): any {
    const props = { ...(override?.props ?? libEl.default_properties) };
    // Date.now() в синхронном цикле даёт одинаковые значения — добавляем счётчик.
    const uid   = override?.id ?? `${libEl.type}-${Date.now()}-${this.elementSeq++}`;
    const label = override?.label ?? libEl.name;
    const w = props.width ?? 60;
    const h = props.height ?? 60;

    let shape: Konva.Node;

    switch (libEl.type) {
      case 'button':
        shape = this.createButton(x, y, w, h, props, uid, label);
        break;
      case 'lamp':
        shape = this.createLamp(x, y, w, h, props, uid, label);
        break;
      case 'pipe':
        shape = this.createPipe(x, y, w, h, props, uid);
        break;
      case 'gauge':
        shape = this.createGauge(x, y, w, h, props, uid, label);
        break;
      case 'display':
        shape = this.createDisplay(x, y, w, h, props, uid);
        break;
      case 'sensor':
        shape = this.createSensor(x, y, w, h, props, uid, label);
        break;
      case 'valve':
        shape = this.createValve(x, y, w, h, props, uid, label);
        break;
      case 'pump':
        shape = this.createPump(x, y, w, h, props, uid, label);
        break;
      case 'boiler':
        shape = this.createBoiler(x, y, w, h, props, uid, label);
        break;
      case 'label':
        shape = this.createLabel(x, y, props, uid);
        break;
      default:
        shape = this.createGeneric(x, y, w, h, props, uid, label, libEl.icon);
    }

    // Meta
    shape.setAttrs({
      elementId:   uid,
      elementType: libEl.type,
      variable:    override?.variable ?? uid,
      label,
      libId:       libEl.id,
      canvasProps: props,
    });

    // Click: выбор элемента или подбор конца связи (в режиме связывания)
    shape.on('click', () => this.onElementClicked(shape));
    // Перемещение — связи тянутся за элементом
    shape.on('dragmove', () => this.redrawConnections());
    shape.on('dragend', () => this.layer.draw());

    this.layer.add(shape as any);
    this.layer.draw();
    // При загрузке шаблона (override) элемент не выделяем — иначе выделится последний.
    if (!override) this.selectNode(shape);
    return shape;
  }

  createButton(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const r = Math.min(w, h) / 2;
    g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, fill: props.offColor ?? '#555', stroke: props.color, strokeWidth: 3 }));
    g.add(new Konva.Text({ x: 0, y: r * 2 + 4, width: w, text: name, fontSize: 10, fill: '#ffffff', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  createLamp(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const r = Math.min(w, h) / 2;
    g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, fill: props.offColor ?? '#333', stroke: props.color, strokeWidth: 2 }));
    g.add(new Konva.Text({ x: 0, y: r * 2 + 4, width: w, text: name, fontSize: 10, fill: '#ffffff', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  createPipe(x: number, y: number, w: number, h: number, props: any, uid: string): any {
    return new Konva.Rect({ x, y, width: w, height: h, fill: props.color ?? '#1E88E5', cornerRadius: Math.min(w, h) / 3, draggable: true, id: uid });
  }

  createGauge(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    g.add(new Konva.Circle({ x: w / 2, y: h / 2, radius: w / 2 - 2, fill: '#1A2A3A', stroke: '#4FC3F7', strokeWidth: 2 }));
    g.add(new Konva.Text({ x: 0, y: h / 2 - 10, width: w, text: '0.0', fontSize: 16, fill: '#4FC3F7', align: 'center', fontStyle: 'bold' }));
    g.add(new Konva.Text({ x: 0, y: h / 2 + 8, width: w, text: props.unit ?? '', fontSize: 10, fill: '#607D8B', align: 'center' }));
    g.add(new Konva.Text({ x: 0, y: h + 4, width: w, text: name, fontSize: 10, fill: '#ffffff', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  createDisplay(x: number, y: number, w: number, h: number, props: any, uid: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    g.add(new Konva.Rect({ width: w, height: h, fill: '#0D1F2D', stroke: '#4FC3F7', strokeWidth: 1, cornerRadius: 4 }));
    g.add(new Konva.Text({ x: 4, y: h / 2 - 9, width: w - 8, text: '---', fontSize: props.fontSize ?? 18, fill: '#4FC3F7', align: 'center' }));
    return g;
  }

  createSensor(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    g.add(new Konva.Rect({ width: w, height: h - 16, fill: '#1A2A3A', stroke: '#607D8B', strokeWidth: 1, cornerRadius: 4 }));
    g.add(new Konva.Text({ x: 0, y: 8, width: w, text: '0.0', fontSize: 16, fill: '#4FC3F7', align: 'center', fontStyle: 'bold' }));
    g.add(new Konva.Text({ x: 0, y: 28, width: w, text: props.unit ?? '', fontSize: 11, fill: '#607D8B', align: 'center' }));
    g.add(new Konva.Text({ x: 0, y: h - 14, width: w, text: name, fontSize: 10, fill: '#ffffff', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  createValve(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;
    g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: 'transparent', stroke: props.color ?? '#FF9800', strokeWidth: 2 }));
    g.add(new Konva.Line({ points: [cx - r, cy, cx + r, cy], stroke: props.color ?? '#FF9800', strokeWidth: 2 }));
    g.add(new Konva.Line({ points: [cx, cy - r, cx, cy + r], stroke: props.color ?? '#FF9800', strokeWidth: 2 }));
    g.add(new Konva.Text({ x: 0, y: h + 2, width: w, text: name, fontSize: 10, fill: '#ffffff', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  createPump(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const r = Math.min(w, h) / 2 - 2;
    g.add(new Konva.Circle({ x: w / 2, y: h / 2, radius: r, fill: '#1A2A3A', stroke: props.color ?? '#9C27B0', strokeWidth: 2 }));
    g.add(new Konva.RegularPolygon({ x: w / 2, y: h / 2, sides: 3, radius: r - 6, fill: props.color ?? '#9C27B0', rotation: 90 }));
    g.add(new Konva.Text({ x: 0, y: h + 2, width: w, text: name, fontSize: 10, fill: '#ffffff', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  /** Котёл (барабан): корпус, зеркало воды и топка снизу. */
  createBoiler(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    // корпус
    g.add(new Konva.Rect({ width: w, height: h, fill: '#2B3A47', stroke: props.color ?? '#5A6B7A', strokeWidth: 2, cornerRadius: 16 }));
    // зеркало воды (нижняя часть барабана)
    const wl = Math.round(h * 0.5);
    g.add(new Konva.Rect({ x: 6, y: wl, width: w - 12, height: h - wl - 22, fill: '#15466b', opacity: 0.55, cornerRadius: 4 }));
    g.add(new Konva.Line({ points: [8, wl, w - 8, wl], stroke: '#4FC3F7', strokeWidth: 1.5, dash: [7, 4] }));
    // топка снизу
    g.add(new Konva.Rect({ x: 12, y: h - 20, width: w - 24, height: 12, fill: '#5D2E12', cornerRadius: 5 }));
    // название
    g.add(new Konva.Text({ x: 0, y: 14, width: w, text: name, fontSize: 14, fill: '#CFD8DC', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  createLabel(x: number, y: number, props: any, uid: string): any {
    return new Konva.Text({ x, y, text: props.text ?? 'Метка', fontSize: props.fontSize ?? 14, fill: props.color ?? '#607D8B', draggable: true, id: uid });
  }

  createGeneric(x: number, y: number, w: number, h: number, props: any, uid: string, name: string, icon: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    g.add(new Konva.Rect({ width: w, height: h, fill: '#1A2A3A', stroke: '#607D8B', strokeWidth: 1, cornerRadius: 4 }));
    g.add(new Konva.Text({ x: 0, y: h / 2 - 10, width: w, text: icon, fontSize: 18, align: 'center', fill: '#4FC3F7' }));
    g.add(new Konva.Text({ x: 0, y: h + 2, width: w, text: name, fontSize: 10, fill: '#ffffff', align: 'center', fontStyle: 'bold' }));
    return g;
  }

  // ── Selection & properties ──────────────────────────────────────────────────

  selectNode(node: Konva.Node): void {
    this.transformer.nodes([node]);
    this.selectedNode = node;
    this.selectedElement = {
      id:       node.getAttr('elementId'),
      type:     node.getAttr('elementType'),
      x:        Math.round(node.x()),
      y:        Math.round(node.y()),
      width:    node.width(),
      height:   node.height(),
      variable: node.getAttr('variable') ?? '',
      label:    node.getAttr('label') ?? '',
      props:    node.getAttr('canvasProps') ?? {},
    };
    this.layer.draw();
  }

  updateVariable(value: string): void {
    if (!this.selectedNode) return;
    this.selectedNode.setAttr('variable', value);
    if (this.selectedElement) this.selectedElement.variable = value;
  }

  updateLabel(value: string): void {
    if (!this.selectedNode || !this.selectedElement) return;
    this.selectedNode.setAttr('label', value);
    this.selectedElement.label = value;
    this.rebuildSelected();   // обновить подпись на холсте
  }

  /** Изменение свойства (props) выбранного элемента с перерисовкой ноды. */
  updateProp(key: string, value: any, numeric = false): void {
    if (!this.selectedNode || !this.selectedElement) return;
    let v: any = value;
    if (numeric) {
      v = parseFloat(value);
      if (Number.isNaN(v)) return;
    }
    const props = { ...(this.selectedNode.getAttr('canvasProps') ?? {}), [key]: v };
    this.selectedNode.setAttr('canvasProps', props);
    this.selectedElement.props = props;
    this.rebuildSelected();
  }

  /** После растягивания рамкой переводит масштаб ноды в размеры (props) и перерисовывает. */
  private applyTransform(): void {
    const node = this.selectedNode;
    if (!node) return;
    const sx = node.scaleX();
    const sy = node.scaleY();
    if (sx === 1 && sy === 1) return;

    const props = { ...(node.getAttr('canvasProps') ?? {}) };
    props.width  = Math.max(4, Math.round((props.width  ?? 60) * sx));
    props.height = Math.max(4, Math.round((props.height ?? 60) * sy));
    node.setAttr('canvasProps', props);
    if (this.selectedElement) this.selectedElement.props = props;

    // Масштаб «впечатан» в размеры — сбрасываем его и пересоздаём ноду чисто.
    node.scaleX(1);
    node.scaleY(1);
    this.rebuildSelected();
  }

  /** Пересоздаёт выбранную ноду из её текущих props (id/variable/label/позиция сохраняются). */
  private rebuildSelected(): void {
    const node = this.selectedNode;
    if (!node) return;
    const elementType = node.getAttr('elementType');
    const libId       = node.getAttr('libId');
    const id          = node.getAttr('elementId');
    const variable    = node.getAttr('variable');
    const label       = node.getAttr('label');
    const props       = node.getAttr('canvasProps') ?? {};
    const x = node.x();
    const y = node.y();

    const libEl = this.libraryElements.find(e => e.id === libId) ?? {
      id: libId ?? id, name: label ?? elementType, category: 'controls',
      type: elementType, icon: '?', default_properties: props,
    };

    this.transformer.nodes([]);
    node.destroy();

    const newNode = this.addElementToCanvas(libEl, x, y, { id, variable, label, props });
    this.selectNode(newNode);
    this.redrawConnections();   // размер/центр мог измениться — обновить линии
  }

  deleteSelected(): void {
    if (!this.selectedNode) return;
    const variable = this.selectedNode.getAttr('variable');
    this.transformer.nodes([]);
    this.selectedNode.destroy();
    this.selectedNode = null;
    this.selectedElement = null;
    // Удаляем связи, ссылающиеся на удалённый элемент
    if (variable) {
      this.connections = this.connections.filter(c => c.from !== variable && c.to !== variable);
    }
    this.redrawConnections();
    this.layer.draw();
  }

  // ── Serialization & save ────────────────────────────────────────────────────

  getCanvasElements(): CanvasElement[] {
  return this.layer.getChildren()
    // исключаем трансформер и линии связей — это не элементы холста
    .filter(n => !(n instanceof Konva.Transformer) && n.name() !== 'connection')
    .map((n: any) => {
      const props = n.getAttr('canvasProps') ?? {};
      const rect  = n.getClientRect({ skipTransform: false });
      return {
        id:       n.getAttr('elementId') ?? n.id(),
        type:     n.getAttr('elementType') ?? 'unknown',
        x:        Math.round(n.x()),
        y:        Math.round(n.y()),
        // Размер тела элемента (без подписи) — из props; getClientRect включает
        // высоту текста подписи и для построения непригоден.
        width:    Math.round(props.width  ?? rect.width),
        height:   Math.round(props.height ?? rect.height),
        variable: n.getAttr('variable') ?? '',
        label:    n.getAttr('label') ?? '',
        props:    n.getAttr('canvasProps') ?? {},
        libId:    n.getAttr('libId') ?? '',
      };
    });
}

  // ── Эталонный сценарий ────────────────────────────────────────────────────────

  /**
   * Органы управления, присутствующие на холсте, — только они допустимы в шагах
   * сценария. Индикаторы (манометр, уровнемер, дисплей) сюда не попадают.
   */
  controlElements(): { variable: string; label: string }[] {
    if (!this.layer) return [];
    return this.layer.getChildren()
      .filter((n: any) => !(n instanceof Konva.Transformer)
                          && this.CONTROL_TYPES.includes(n.getAttr('elementType')))
      .map((n: any) => ({
        variable: n.getAttr('variable') ?? '',
        label:    n.getAttr('label') ?? n.getAttr('variable') ?? '',
      }))
      .filter(e => !!e.variable);
  }

  /** Подпись органа управления по его variable (для отображения шага). */
  stepLabel(variable: string): string {
    return this.controlElements().find(e => e.variable === variable)?.label ?? variable;
  }

  /** Существует ли ещё на холсте орган управления, на который ссылается шаг. */
  stepIsValid(step: ScenarioStep): boolean {
    return this.controlElements().some(e => e.variable === step.element_id);
  }

  /** Добавить шаг по выбранному в выпадающем списке элементу. */
  addStep(): void {
    if (!this.newStepVar) return;
    this.scenario.push({
      step:           this.scenario.length + 1,
      element_id:     this.newStepVar,
      expected_value: true,
      description:    '',
    });
    this.newStepVar = '';
  }

  removeStep(i: number): void {
    this.scenario.splice(i, 1);
    this.renumber();
  }

  moveStep(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.scenario.length) return;
    [this.scenario[i], this.scenario[j]] = [this.scenario[j], this.scenario[i]];
    this.renumber();
  }

  toggleStepValue(step: ScenarioStep): void {
    step.expected_value = !step.expected_value;
  }

  setStepDescription(step: ScenarioStep, value: string): void {
    step.description = value;
  }

  private renumber(): void {
    this.scenario.forEach((s, i) => (s.step = i + 1));
  }

  /** Чистый массив шагов для сохранения (отбрасываем «битые» ссылки). */
  private cleanScenario(): ScenarioStep[] {
    return this.scenario
      .filter(s => this.stepIsValid(s))
      .map((s, i) => ({
        step:           i + 1,
        element_id:     s.element_id,
        expected_value: s.expected_value,
        description:    (s.description ?? '').trim(),
      }));
  }

  // ── Триггеры (правила) ────────────────────────────────────────────────────────

  /** Все элементы на холсте, у которых задана переменная (для источников и целей правил). */
  allElements(): { variable: string; label: string }[] {
    if (!this.layer) return [];
    return this.layer.getChildren()
      .filter((n: any) => !(n instanceof Konva.Transformer) && !!n.getAttr('variable'))
      .map((n: any) => ({
        variable: n.getAttr('variable'),
        label:    n.getAttr('label') ?? n.getAttr('variable'),
      }));
  }

  /** Подпись элемента по variable (для отображения в правиле). */
  varLabel(variable: string): string {
    return this.allElements().find(e => e.variable === variable)?.label ?? variable;
  }

  addRule(): void {
    const first = this.controlElements()[0]?.variable ?? '';
    this.rules.push({
      if:   { variable: first, op: 'eq', value: true },
      then: [{ variable: '', set: true }],
    });
  }

  removeRule(i: number): void {
    this.rules.splice(i, 1);
  }

  toggleRuleOp(rule: Rule): void {
    rule.if.op = rule.if.op === 'eq' ? 'neq' : 'eq';
  }

  toggleRuleValue(rule: Rule): void {
    rule.if.value = !rule.if.value;
  }

  addAction(rule: Rule): void {
    rule.then.push({ variable: '', set: true });
  }

  removeAction(rule: Rule, j: number): void {
    rule.then.splice(j, 1);
  }

  toggleActionSet(action: RuleAction): void {
    action.set = !action.set;
  }

  /** Корректно ли правило: источник и хотя бы одно действие с выбранной целью. */
  ruleIsValid(rule: Rule): boolean {
    return !!rule.if.variable && rule.then.some(a => !!a.variable);
  }

  /** Чистый массив правил для сохранения (отбрасываем неполные). */
  private cleanRules(): Rule[] {
    return this.rules
      .filter(r => this.ruleIsValid(r))
      .map(r => ({
        if:   { variable: r.if.variable, op: r.if.op, value: r.if.value },
        then: r.then.filter(a => !!a.variable).map(a => ({ variable: a.variable, set: a.set })),
      }));
  }

  // ── Связи (трубы между элементами) ─────────────────────────────────────────────

  /** Клик по элементу: выбор или подбор конца связи в режиме связывания. */
  private onElementClicked(node: any): void {
    if (this.connectMode) { this.pickConnectionEndpoint(node); return; }
    this.selectNode(node);
  }

  toggleConnectMode(): void {
    this.connectMode = !this.connectMode;
    this.connectFrom = null;
    if (this.connectMode) {
      // В режиме связывания снимаем выделение, чтобы не мешал трансформер.
      this.transformer.nodes([]);
      this.selectedNode = null;
      this.selectedElement = null;
      this.layer.draw();
    }
  }

  private pickConnectionEndpoint(node: any): void {
    const v = node.getAttr('variable');
    if (!v) return;
    if (!this.connectFrom) {
      this.connectFrom = v;                 // выбран источник
    } else if (this.connectFrom === v) {
      this.connectFrom = null;              // клик по тому же — отмена
    } else {
      this.addConnection(this.connectFrom, v);
      this.connectFrom = null;
    }
  }

  private addConnection(from: string, to: string): void {
    const exists = this.connections.some(c =>
      (c.from === from && c.to === to) || (c.from === to && c.to === from));
    if (!exists) this.connections.push({ from, to, medium: 'none', width: this.DEFAULT_CONN_WIDTH });
    this.redrawConnections();
  }

  /** Цвет трубы по среде. */
  mediumColor(medium?: string): string {
    return this.MEDIA.find(m => m.value === (medium ?? 'none'))?.color ?? '#90A4AE';
  }

  removeConnection(i: number): void {
    this.connections.splice(i, 1);
    this.redrawConnections();
  }

  /** Публичная обёртка для перерисовки связей из шаблона (при смене среды/ширины). */
  redrawConnectionsPublic(): void {
    this.redrawConnections();
  }

  /** Ортогональная (Г-образная) трасса между точками — длинную сторону ведём первой. */
  private elbow(a: { x: number; y: number }, b: { x: number; y: number }): number[] {
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    return dx >= dy
      ? [a.x, a.y, b.x, a.y, b.x, b.y]   // горизонталь → вертикаль
      : [a.x, a.y, a.x, b.y, b.x, b.y];  // вертикаль → горизонталь
  }

  /** Центр элемента по его variable (для концов линии связи). */
  private elementCenter(variable: string): { x: number; y: number } | null {
    const node = this.layer.getChildren().find((n: any) =>
      !(n instanceof Konva.Transformer) && n.getAttr('variable') === variable) as any;
    if (!node) return null;
    const p = node.getAttr('canvasProps') ?? {};
    const w = p.width ?? 60, h = p.height ?? 60;
    return { x: node.x() + w / 2, y: node.y() + h / 2 };
  }

  /** Перерисовывает все линии связей (под элементами). */
  private redrawConnections(): void {
    if (!this.layer) return;
    this.layer.find('.connection').forEach((l: any) => l.destroy());
    this.connections.forEach(c => {
      const a = this.elementCenter(c.from);
      const b = this.elementCenter(c.to);
      if (!a || !b) return;
      const line = new Konva.Line({
        points: this.elbow(a, b),
        stroke: this.mediumColor(c.medium),
        strokeWidth: c.width ?? this.DEFAULT_CONN_WIDTH,
        lineCap: 'round', lineJoin: 'round',
        name: 'connection', listening: false,
      });
      this.layer.add(line);
      line.moveToBottom();
    });
    this.layer.batchDraw();
  }

  /** Чистый массив связей для сохранения (только с существующими элементами). */
  private cleanConnections(): Connection[] {
    const vars = new Set(this.allElements().map(e => e.variable));
    return this.connections
      .filter(c => vars.has(c.from) && vars.has(c.to))
      .map(c => ({
        from:   c.from,
        to:     c.to,
        medium: c.medium ?? 'none',
        width:  c.width ?? this.DEFAULT_CONN_WIDTH,
      }));
  }

  /** Сохраняет текущее состояние шаблона (POST/PATCH) и возвращает Observable ответа. */
  private persist() {
    const payload = {
      name:        this.simName,
      description: this.simDescription,
      module:      this.moduleId ?? null,
      canvas_w:    this.CANVAS_W,
      canvas_h:    this.CANVAS_H,
      elements:    this.getCanvasElements(),
      rules:       this.cleanRules(),
      reference_scenario: this.cleanScenario(),
      connections: this.cleanConnections(),
      library_set: this.activeLibrarySet,
      // Сохранение правок не должно снимать публикацию: сохраняем текущий статус.
      status:      this.published ? 'published' : 'draft',
    };

    return this.templateId
      ? this.api.patch<any>(`simulations/templates/${this.templateId}/`, payload)
      : this.api.post<any>('simulations/templates/', payload);
  }

  save(): void {
    this.saving = true;
    this.persist().subscribe({
      next: (res) => {
        this.saving = false;
        this.saved = true;
        if (!this.templateId) this.templateId = res.id;
        setTimeout(() => this.saved = false, 2000);
      },
      error: () => { this.saving = false; },
    });
  }

  /** Сохраняет черновик и открывает плеер для проверки (без публикации). */
  testRun(): void {
    this.saving = true;
    this.persist().subscribe({
      next: (res) => {
        this.saving = false;
        if (!this.templateId) this.templateId = res.id;
        this.router.navigate(['/simulator', this.templateId, 'play'], { queryParams: { test: 1 } });
      },
      error: () => { this.saving = false; },
    });
  }

 publish(): void {
  if (!this.templateId || this.published) return;   // уже опубликована — повторно не публикуем
  this.api.post(`simulations/templates/${this.templateId}/publish/`, {}).subscribe({
    next: () => {
      this.published = true;
      alert('Симуляция опубликована');
    },
  });
}

  loadTemplate(): void {
  this.api.get<any>(`simulations/templates/${this.templateId}/`).subscribe({
    next: (tmpl) => {
      this.simName        = tmpl.name;
      this.simDescription = tmpl.description ?? '';
      this.published      = tmpl.status === 'published';
      // Триггеры приводим к типизированному виду (с дефолтами на случай старого формата)
      this.rules = [...(tmpl.rules ?? [])].map((r: any) => ({
        if: {
          variable: r?.if?.variable ?? '',
          op:       r?.if?.op === 'neq' ? 'neq' : 'eq',
          value:    r?.if?.value ?? true,
        },
        then: [...(r?.then ?? [])].map((a: any) => ({
          variable: a?.variable ?? '',
          set:      a?.set ?? true,
        })),
      }));
      this.scenario = [...(tmpl.reference_scenario ?? [])]
        .sort((a: any, b: any) => (a.step ?? 0) - (b.step ?? 0))
        .map((s: any, i: number) => ({
          step:           i + 1,
          element_id:     s.element_id ?? '',
          expected_value: s.expected_value ?? true,
          description:    s.description ?? s.hint ?? '',
        }));
      this.connections = [...(tmpl.connections ?? [])]
        .filter((c: any) => c?.from && c?.to)
        .map((c: any) => ({
          from:   c.from,
          to:     c.to,
          medium: c.medium ?? 'none',
          width:  c.width ?? this.DEFAULT_CONN_WIDTH,
        }));
      if (!this.moduleId && tmpl.module) {
        this.moduleId = String(tmpl.module);
      }
      if (tmpl.library_set && tmpl.library_set !== this.activeLibrarySet) {
        this.activeLibrarySet = tmpl.library_set;
        this.loadLibrary();
      }
      setTimeout(() => {
        const elements = tmpl.elements ?? [];
        elements.forEach((el: any) => {
          const libEl = this.libraryElements.find(e => e.id === el.libId) ?? {
            id: el.libId ?? el.id,
            name: el.label ?? el.type,
            category: 'controls',
            type: el.type,
            icon: '?',
            default_properties: el.props ?? {},
          };
          // Восстанавливаем элемент точь-в-точь: id, variable, label и размеры
          // из сохранённых props (а не из библиотечных дефолтов).
          this.addElementToCanvas(libEl, el.x, el.y, {
            id:       el.id,
            variable: el.variable,
            label:    el.label,
            props:    el.props,
          });
        });
        this.redrawConnections();
        this.layer.draw();
      }, 200);
    },
  });
}
}
