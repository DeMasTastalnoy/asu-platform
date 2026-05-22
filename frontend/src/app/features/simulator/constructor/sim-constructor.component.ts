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

  // Simulation meta
  simName = 'Новая симуляция';
  simDescription = '';
  moduleId: string | null = null;
  templateId: string | null = null;
  saving = false;
  saved = false;
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
  }

  drawGrid(layer: Konva.Layer): void {
    const step = 20;
    for (let x = 0; x <= this.CANVAS_W; x += step) {
      layer.add(new Konva.Line({ points: [x, 0, x, this.CANVAS_H], stroke: '#e8ecf0', strokeWidth: 0.5 }));
    }
    for (let y = 0; y <= this.CANVAS_H; y += step) {
      layer.add(new Konva.Line({ points: [0, y, this.CANVAS_W, y], stroke: '#e8ecf0', strokeWidth: 0.5 }));
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
      controls: 'Управление', indicators: 'Индикаторы',
      pipes: 'Трубопровод', valves: 'Арматура', sensors: 'Датчики',
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

    const rect = this.konvaContainer.nativeElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.addElementToCanvas(libEl, x, y);
  }

  // ── Canvas elements ─────────────────────────────────────────────────────────

  addElementToCanvas(libEl: LibraryElement, x: number, y: number): void {
    const props = { ...libEl.default_properties };
    const uid = `${libEl.type}-${Date.now()}`;
    const w = props.width ?? 60;
    const h = props.height ?? 60;

    let shape: Konva.Node;

    switch (libEl.type) {
      case 'button':
        shape = this.createButton(x, y, w, h, props, uid, libEl.name);
        break;
      case 'lamp':
        shape = this.createLamp(x, y, w, h, props, uid, libEl.name);
        break;
      case 'pipe':
        shape = this.createPipe(x, y, w, h, props, uid);
        break;
      case 'gauge':
        shape = this.createGauge(x, y, w, h, props, uid, libEl.name);
        break;
      case 'display':
        shape = this.createDisplay(x, y, w, h, props, uid);
        break;
      case 'sensor':
        shape = this.createSensor(x, y, w, h, props, uid, libEl.name);
        break;
      case 'valve':
        shape = this.createValve(x, y, w, h, props, uid, libEl.name);
        break;
      case 'pump':
        shape = this.createPump(x, y, w, h, props, uid, libEl.name);
        break;
      case 'label':
        shape = this.createLabel(x, y, props, uid);
        break;
      default:
        shape = this.createGeneric(x, y, w, h, props, uid, libEl.name, libEl.icon);
    }

    // Meta
    shape.setAttrs({ elementId: uid, elementType: libEl.type, variable: uid, label: libEl.name, libId: libEl.id, canvasProps: props });

    // Click to select
    shape.on('click', () => this.selectNode(shape));
    shape.on('dragend', () => this.layer.draw());

    this.layer.add(shape as any);
    this.layer.draw();
    this.selectNode(shape);
  }

  createButton(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const r = Math.min(w, h) / 2;
    g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, fill: props.offColor ?? '#555', stroke: props.color, strokeWidth: 3 }));
    g.add(new Konva.Text({ x: 0, y: r * 2 + 4, width: w, text: name, fontSize: 10, fill: '#aaa', align: 'center' }));
    return g;
  }

  createLamp(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const r = Math.min(w, h) / 2;
    g.add(new Konva.Circle({ x: r, y: r, radius: r - 2, fill: props.offColor ?? '#333', stroke: props.color, strokeWidth: 2 }));
    g.add(new Konva.Text({ x: 0, y: r * 2 + 4, width: w, text: name, fontSize: 10, fill: '#aaa', align: 'center' }));
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
    g.add(new Konva.Text({ x: 0, y: h + 4, width: w, text: name, fontSize: 10, fill: '#aaa', align: 'center' }));
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
    g.add(new Konva.Text({ x: 0, y: h - 14, width: w, text: name, fontSize: 10, fill: '#aaa', align: 'center' }));
    return g;
  }

  createValve(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 4;
    g.add(new Konva.Circle({ x: cx, y: cy, radius: r, fill: 'transparent', stroke: props.color ?? '#FF9800', strokeWidth: 2 }));
    g.add(new Konva.Line({ points: [cx - r, cy, cx + r, cy], stroke: props.color ?? '#FF9800', strokeWidth: 2 }));
    g.add(new Konva.Line({ points: [cx, cy - r, cx, cy + r], stroke: props.color ?? '#FF9800', strokeWidth: 2 }));
    g.add(new Konva.Text({ x: 0, y: h + 2, width: w, text: name, fontSize: 10, fill: '#aaa', align: 'center' }));
    return g;
  }

  createPump(x: number, y: number, w: number, h: number, props: any, uid: string, name: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    const r = Math.min(w, h) / 2 - 2;
    g.add(new Konva.Circle({ x: w / 2, y: h / 2, radius: r, fill: '#1A2A3A', stroke: props.color ?? '#9C27B0', strokeWidth: 2 }));
    g.add(new Konva.RegularPolygon({ x: w / 2, y: h / 2, sides: 3, radius: r - 6, fill: props.color ?? '#9C27B0', rotation: 90 }));
    g.add(new Konva.Text({ x: 0, y: h + 2, width: w, text: name, fontSize: 10, fill: '#aaa', align: 'center' }));
    return g;
  }

  createLabel(x: number, y: number, props: any, uid: string): any {
    return new Konva.Text({ x, y, text: props.text ?? 'Метка', fontSize: props.fontSize ?? 14, fill: props.color ?? '#607D8B', draggable: true, id: uid });
  }

  createGeneric(x: number, y: number, w: number, h: number, props: any, uid: string, name: string, icon: string): any {
    const g = new Konva.Group({ x, y, draggable: true, id: uid });
    g.add(new Konva.Rect({ width: w, height: h, fill: '#1A2A3A', stroke: '#607D8B', strokeWidth: 1, cornerRadius: 4 }));
    g.add(new Konva.Text({ x: 0, y: h / 2 - 10, width: w, text: icon, fontSize: 18, align: 'center', fill: '#4FC3F7' }));
    g.add(new Konva.Text({ x: 0, y: h + 2, width: w, text: name, fontSize: 10, fill: '#aaa', align: 'center' }));
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
    if (!this.selectedNode) return;
    this.selectedNode.setAttr('label', value);
    if (this.selectedElement) this.selectedElement.label = value;
  }

  deleteSelected(): void {
    if (!this.selectedNode) return;
    this.transformer.nodes([]);
    this.selectedNode.destroy();
    this.selectedNode = null;
    this.selectedElement = null;
    this.layer.draw();
  }

  // ── Serialization & save ────────────────────────────────────────────────────

  getCanvasElements(): CanvasElement[] {
  return this.layer.getChildren()
    .filter(n => !(n instanceof Konva.Transformer))
    .map((n: any) => {
      const rect = n.getClientRect({ skipTransform: false });
      return {
        id:       n.getAttr('elementId') ?? n.id(),
        type:     n.getAttr('elementType') ?? 'unknown',
        x:        Math.round(n.x()),
        y:        Math.round(n.y()),
        width:    Math.round(rect.width),
        height:   Math.round(rect.height),
        variable: n.getAttr('variable') ?? '',
        label:    n.getAttr('label') ?? '',
        props:    n.getAttr('canvasProps') ?? {},
        libId:    n.getAttr('libId') ?? '',
      };
    });
}

  save(): void {
    this.saving = true;
    const payload = {
      name:        this.simName,
      description: this.simDescription,
      module:      this.moduleId ?? null,
      canvas_w:    this.CANVAS_W,
      canvas_h:    this.CANVAS_H,
      elements:    this.getCanvasElements(),
      rules:       [],
      reference_scenario: [],
      library_set: this.activeLibrarySet,
      status:      'draft',
    };

    const req = this.templateId
      ? this.api.patch<any>(`simulations/templates/${this.templateId}/`, payload)
      : this.api.post<any>('simulations/templates/', payload);

    req.subscribe({
      next: (res) => {
        this.saving = false;
        this.saved = true;
        if (!this.templateId) this.templateId = res.id;
        setTimeout(() => this.saved = false, 2000);
      },
      error: () => { this.saving = false; },
    });
  }

 publish(): void {
  if (!this.templateId) return;
  this.api.post(`simulations/templates/${this.templateId}/publish/`, {}).subscribe({
    next: () => {
      alert('Симуляция опубликована');
    },
  });
}

  loadTemplate(): void {
  this.api.get<any>(`simulations/templates/${this.templateId}/`).subscribe({
    next: (tmpl) => {
      this.simName        = tmpl.name;
      this.simDescription = tmpl.description ?? '';
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
          this.addElementToCanvas(libEl, el.x, el.y);
          const node = this.layer.findOne(`#${el.id}`);
          if (node) {
            node.setAttrs({
              elementId: el.id,
              variable:  el.variable,
              label:     el.label,
              canvasProps: el.props,
            });
            node.x(el.x);
            node.y(el.y);
          }
        });
        this.layer.draw();
      }, 200);
    },
  });
}
}
