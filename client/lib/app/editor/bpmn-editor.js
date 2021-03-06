'use strict';

var inherits = require('inherits');

var assign = require('lodash/object/assign');

var domify = require('domify');

var DiagramEditor = require('./diagram-editor');

var BpmnJS = require('bpmn-js/lib/Modeler');

var diagramOriginModule = require('diagram-js-origin'),
    executableFixModule = require('./bpmn/executable-fix'),
    propertiesPanelModule = require('bpmn-js-properties-panel'),
    propertiesProviderModule = require('bpmn-js-properties-panel/lib/provider/camunda'),
    camundaModdlePackage = require('camunda-bpmn-moddle/resources/camunda');

var nyanPaletteModule = require('bpmn-js-nyan/lib/nyan/palette'),
    nyanDrawModule = require('bpmn-js-nyan/lib/nyan/draw');


var WarningsOverlay = require('base/components/warnings-overlay');

var getWarnings = require('app/util/get-warnings');

var ensureOpts = require('util/ensure-opts'),
    dragger = require('util/dom/dragger'),
    isInputActive = require('util/dom/is-input').active,
    copy = require('util/copy');

var generateImage = require('app/util/generate-image');

var debug = require('debug')('bpmn-editor');


/**
 * A BPMN 2.0 diagram editing component.
 *
 * @param {Object} options
 */
function BpmnEditor(options) {

  ensureOpts([ 'layout' ], options);

  DiagramEditor.call(this, options);

  this.name = 'bpmn';

  // elements to insert modeler and properties panel into
  this.$propertiesEl = domify('<div class="properties-parent"></div>');
}

inherits(BpmnEditor, DiagramEditor);

module.exports = BpmnEditor;


BpmnEditor.prototype.triggerEditorActions = function(action, options) {
  var opts = options || {};

  var modeler = this.getModeler();

  var editorActions = modeler.get('editorActions', false);

  if (!editorActions) {
    return;
  }

  if ('moveCanvas' === action) {
    opts = assign({ speed: 20 }, options);
  }

  if ('zoomIn' === action) {
    action = 'stepZoom';

    opts = {
      value: 1
    };
  }

  if ('zoomOut' === action) {
    action = 'stepZoom';

    opts = {
      value: -1
    };
  }

  if ('zoom' === action) {
    opts = assign({
      value: 1
    }, options);
  }

  // ignore all editor actions (besides the following three)
  // if there's a current active input or textarea
  if ([ 'removeSelection', 'stepZoom', 'zoom', 'find' ].indexOf(action) === -1 && isInputActive()) {
    return;
  }

  debug('editor-actions', action, opts);

  // forward other actions to editor actions
  editorActions.trigger(action, opts);
};


BpmnEditor.prototype.updateState = function() {

  var modeler = this.getModeler(),
      initialState = this.initialState,
      commandStack,
      inputActive;

  // ignore change events during import
  if (initialState.importing) {
    return;
  }

  var elementsSelected,
      elements,
      dirty;

  var stateContext = {
    bpmn: true,
    undo: !!initialState.undo,
    redo: !!initialState.redo,
    dirty: initialState.dirty,
    exportAs: [ 'png', 'jpeg', 'svg' ]
  };

  // no diagram to harvest, good day maam!
  if (isImported(modeler)) {
    commandStack = modeler.get('commandStack');

    dirty = (
      initialState.dirty ||
      initialState.reimported ||
      initialState.stackIndex !== commandStack._stackIdx
    );

    // direct editing function
    elements = modeler.get('selection').get();
    elementsSelected = false;

    if (elements.length >= 1) {
      elementsSelected = true;
    }

    inputActive = isInputActive();

    stateContext = assign(stateContext, {
      undo: commandStack.canUndo(),
      redo: commandStack.canRedo(),
      elementsSelected: elementsSelected && !inputActive,
      dirty: dirty,
      zoom: true,
      editable: true,
      inactiveInput: !inputActive
    });
  }

  this.emit('state-updated', stateContext);
};

BpmnEditor.prototype.getStackIndex = function() {
  var modeler = this.getModeler();

  return isImported(modeler) ? modeler.get('commandStack')._stackIdx : -1;
};

BpmnEditor.prototype.mountProperties = function(node) {
  debug('mount properties');

  node.appendChild(this.$propertiesEl);
};

BpmnEditor.prototype.unmountProperties = function(node) {
  debug('unmount properties');

  node.removeChild(this.$propertiesEl);
};

BpmnEditor.prototype.resizeProperties = function onDrag(panelLayout, event, delta) {

  var oldWidth = panelLayout.open ? panelLayout.width : 0;

  var newWidth = Math.max(oldWidth + delta.x * -1, 0);

  this.emit('layout:changed', {
    propertiesPanel: {
      open: newWidth > 25,
      width: newWidth
    }
  });

  this.notifyModeler('propertiesPanel.resized');
};

BpmnEditor.prototype.toggleProperties = function() {

  var config = this.layout.propertiesPanel;

  this.emit('layout:changed', {
    propertiesPanel: {
      open: !config.open,
      width: !config.open ? (config.width > 25 ? config.width : 250) : config.width
    }
  });

  this.notifyModeler('propertiesPanel.resized');
};


BpmnEditor.prototype.getModeler = function() {

  if (!this.modeler) {

    // lazily instantiate and cache
    this.modeler = this.createModeler(this.$el, this.$propertiesEl);

    // hook up with modeler change events
    this.modeler.on([
      'commandStack.changed',
      'selection.changed'
    ], this.updateState, this);

    // add importing flag (high priority)
    this.modeler.on('import.parse.start', 1500, () => {
      this.initialState.importing = true;
    });

    // remove importing flag (high priority)
    this.modeler.on('import.done', 1500, () => {
      this.initialState.importing = false;
    });
  }

  return this.modeler;
};


BpmnEditor.prototype.createModeler = function($el, $propertiesEl) {

  var propertiesPanelConfig = {
    'config.propertiesPanel': [ 'value', { parent: $propertiesEl } ]
  };

  return new BpmnJS({
    container: $el,
    position: 'absolute',
    additionalModules: [
      diagramOriginModule,
      executableFixModule,
      propertiesPanelModule,
      propertiesProviderModule,
      propertiesPanelConfig,
      nyanPaletteModule,
      nyanDrawModule
    ],
    moddleExtensions: { camunda: camundaModdlePackage }
  });
};

BpmnEditor.prototype.exportAs = function(type, done) {
  var modeler = this.getModeler();

  modeler.saveSVG((err, svg) => {
    var file = {};

    if (err) {
      return done(err);
    }

    if (type !== 'svg') {
      try {
        assign(file, { contents: generateImage(type, svg) });
      } catch (err) {
        return done(err);
      }
    } else {
      assign(file, { contents: svg });
    }

    done(null, file);
  });
};

BpmnEditor.prototype.render = function() {

  var propertiesLayout = this.layout.propertiesPanel;

  var propertiesStyle = {
    width: (propertiesLayout.open ? propertiesLayout.width : 0) + 'px'
  };

  var warnings = getWarnings(this.lastImport);

  return (
    <div className="bpmn-editor" key={ this.id + '#bpmn' } onFocusin={ this.compose('updateState') }>
      <div className="editor-container"
           tabIndex="0"
           onAppend={ this.compose('mountEditor') }
           onRemove={ this.compose('unmountEditor') }>
      </div>
      <div className="properties" style={ propertiesStyle } tabIndex="0">
        <div className="toggle"
             ref="properties-toggle"
             draggable="true"
             onClick={ this.compose('toggleProperties') }
             onDragstart={ dragger(this.compose('resizeProperties', copy(propertiesLayout))) }>
          Properties Panel
        </div>
        <div className="resize-handle"
             draggable="true"
             onDragStart={ dragger(this.compose('resizeProperties', copy(propertiesLayout))) }></div>
        <div className="properties-container"
             onAppend={ this.compose('mountProperties') }
             onRemove={ this.compose('unmountProperties') }>
        </div>
      </div>
      <WarningsOverlay warnings={ warnings }
                       onShowDetails={ this.compose('openLogger') }
                       onClose={ this.compose('hideWarnings') } />
    </div>
  );
};

/**
 * Notify initialized modeler about an event.
 *
 * @param {String} eventName
 */
BpmnEditor.prototype.notifyModeler = function(eventName) {

  var modeler = this.getModeler();

  try {
    modeler.get('eventBus').fire(eventName);
  } catch (e) {
    // we don't care
  }
};

function isImported(modeler) {
  return !!modeler.definitions;
}
