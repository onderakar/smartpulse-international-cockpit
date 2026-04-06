import { useState, useCallback, useMemo, useRef } from 'react';
import { Responsive, WidthProvider, Layout } from 'react-grid-layout';
import { useProfile } from '../../context/ProfileContext';
import { useLocale } from '../../context/LocaleContext';
import { WidgetType, WidgetLayoutItem } from '@shared/types/dashboard.types';
import { TranslationKey } from '@shared/constants/translations';
import { WidgetContainer } from './WidgetContainer';
import { ErrorBoundary } from '../ErrorBoundary';
import { LiveMonitoringWidget } from '../widgets/LiveMonitoringWidget/LiveMonitoringWidget';
import { MarketPriceWidget } from '../widgets/MarketPriceWidget/MarketPriceWidget';
import { CompanyTradingWidget } from '../widgets/CompanyTradingWidget/CompanyTradingWidget';
import { CurrentScheduleWidget } from '../widgets/CurrentScheduleWidget/CurrentScheduleWidget';
import { LiveBatteryPowerWidget } from '../widgets/LiveBatteryPowerWidget/LiveBatteryPowerWidget';
import { EnergyFlowWidget } from '../widgets/EnergyFlowWidget/EnergyFlowWidget';
import { GipMarketWidget } from '../widgets/GipMarketWidget/GipMarketWidget';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

// ---------- Widget catalog ----------

interface WidgetCatalogEntry {
  type: WidgetType;
  labelKey: TranslationKey;
  defaultLayout: { w: number; h: number; minW: number; minH: number };
}

const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    type: 'live-monitoring',
    labelKey: 'widgetGrid.liveMonitoring',
    defaultLayout: { w: 12, h: 8, minW: 6, minH: 4 },
  },
  {
    type: 'market-prices',
    labelKey: 'widgetGrid.marketPrices',
    defaultLayout: { w: 12, h: 8, minW: 6, minH: 4 },
  },
  {
    type: 'company-trading',
    labelKey: 'widgetGrid.companyTrading',
    defaultLayout: { w: 12, h: 8, minW: 6, minH: 4 },
  },
  {
    type: 'current-schedule',
    labelKey: 'widgetGrid.currentSchedule',
    defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 },
  },
  {
    type: 'live-battery-power',
    labelKey: 'widgetGrid.liveBattery',
    defaultLayout: { w: 3, h: 4, minW: 2, minH: 3 },
  },
  {
    type: 'energy-flow',
    labelKey: 'widgetGrid.energyFlow',
    defaultLayout: { w: 4, h: 5, minW: 3, minH: 4 },
  },
  {
    type: 'gip-market',
    labelKey: 'widgetGrid.gipMarket',
    defaultLayout: { w: 12, h: 8, minW: 6, minH: 4 },
  },
];

const CATALOG_MAP = new Map(WIDGET_CATALOG.map(c => [c.type, c]));

// Default set of active widgets
const DEFAULT_WIDGETS: WidgetLayoutItem[] = [
  { widgetId: 'live-monitoring-1', widgetType: 'live-monitoring', x: 0, y: 0, w: 12, h: 8, minW: 6, minH: 4 },
  { widgetId: 'market-prices-1', widgetType: 'market-prices', x: 0, y: 8, w: 12, h: 8, minW: 6, minH: 4 },
];

// ---------- Component ----------

interface WidgetGridProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function WidgetGrid({ selectedDate, onDateChange }: WidgetGridProps) {
  const { profile, updateProfile } = useProfile();
  const { t } = useLocale();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const activeWidgetsRef = useRef<WidgetLayoutItem[]>(DEFAULT_WIDGETS);

  // Active widgets — from profile or defaults
  const activeWidgets: WidgetLayoutItem[] = useMemo(() => {
    const widgets = profile?.widgetLayout && profile.widgetLayout.length > 0
      ? profile.widgetLayout
      : DEFAULT_WIDGETS;
    activeWidgetsRef.current = widgets;
    console.log('[WidgetGrid] activeWidgets', widgets.map(w => w.widgetId));
    return widgets;
  }, [profile?.widgetLayout]);

  // Build RGL layouts from active widgets
  const layouts = useMemo(() => {
    const lg = activeWidgets.map(w => ({
      i: w.widgetId,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      minW: w.minW,
      minH: w.minH,
    }));
    return { lg };
  }, [activeWidgets]);

  // Persist layout changes — only when positions actually change (prevents infinite loop)
  const handleLayoutChange = useCallback((layout: Layout[]) => {
    const current = activeWidgetsRef.current;
    let changed = false;
    const updated = current.map(w => {
      const l = layout.find(li => li.i === w.widgetId);
      if (!l) return w;
      if (l.x !== w.x || l.y !== w.y || l.w !== w.w || l.h !== w.h) {
        changed = true;
        return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
      }
      return w;
    });
    if (changed) {
      updateProfile({ widgetLayout: updated });
    }
  }, [updateProfile]);

  // Remove widget
  const removeWidget = useCallback((widgetId: string) => {
    const updated = activeWidgetsRef.current.filter(w => w.widgetId !== widgetId);
    updateProfile({ widgetLayout: updated });
  }, [updateProfile]);

  // Add widget from gallery
  const addWidget = useCallback((type: WidgetType) => {
    const catalog = CATALOG_MAP.get(type);
    if (!catalog) return;

    const current = activeWidgetsRef.current;
    const existingIds = new Set(current.map(w => w.widgetId));
    let idx = 1;
    while (existingIds.has(`${type}-${idx}`)) idx++;
    const widgetId = `${type}-${idx}`;

    const maxY = current.reduce((max, w) => Math.max(max, w.y + w.h), 0);

    const newWidget: WidgetLayoutItem = {
      widgetId,
      widgetType: type,
      x: 0,
      y: maxY,
      ...catalog.defaultLayout,
    };

    updateProfile({ widgetLayout: [...current, newWidget] });
    setGalleryOpen(false);
  }, [updateProfile]);

  // Render a widget by type
  const renderWidget = (item: WidgetLayoutItem) => {
    switch (item.widgetType) {
      case 'live-monitoring':
        return <LiveMonitoringWidget />;
      case 'market-prices':
        return <MarketPriceWidget selectedDate={selectedDate} onDateChange={onDateChange} />;
      case 'company-trading':
        return <CompanyTradingWidget selectedDate={selectedDate} onDateChange={onDateChange} />;
      case 'current-schedule':
        return <CurrentScheduleWidget selectedDate={selectedDate} onDateChange={onDateChange} />;
      case 'live-battery-power':
        return <LiveBatteryPowerWidget />;
      case 'energy-flow':
        return <EnergyFlowWidget />;
      case 'gip-market':
        return <GipMarketWidget />;
      default:
        return <div className="text-gray-500 text-sm p-4">{t('widgetGrid.unknownWidget')}</div>;
    }
  };

  return (
    <div className="relative">
      {/* Add widget button */}
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setGalleryOpen(!galleryOpen)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-dark-700 border border-gray-600 rounded-lg text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
        >
          <span className="text-sm">+</span>
          {t('widgetGrid.addWidget')}
        </button>
      </div>

      {/* Widget gallery panel */}
      {galleryOpen && (
        <div className="absolute top-10 right-0 z-50 bg-dark-800 border border-gray-600 rounded-lg shadow-xl p-3 min-w-[220px]">
          <div className="text-xs text-gray-400 mb-2 font-medium">{t('widgetGrid.gallery')}</div>
          <div className="flex flex-col gap-1.5">
            {WIDGET_CATALOG.map(entry => (
              <button
                key={entry.type}
                onClick={() => addWidget(entry.type)}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-dark-700 hover:text-white transition-colors text-left"
              >
                <span className="text-base">
                  {entry.type === 'live-monitoring' ? '📊' : entry.type === 'company-trading' ? '🏢' : entry.type === 'current-schedule' ? '📋' : entry.type === 'live-battery-power' ? '🔋' : entry.type === 'energy-flow' ? '⚡' : entry.type === 'gip-market' ? '📈' : '💹'}
                </span>
                {t(entry.labelKey)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setGalleryOpen(false)}
            className="mt-2 w-full text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {/* Grid layout */}
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768 }}
        cols={{ lg: 12, md: 10, sm: 6 }}
        rowHeight={50}
        isResizable={true}
        isDraggable={true}
        draggableHandle=".widget-drag-handle"
        onLayoutChange={handleLayoutChange}
        margin={[16, 16]}
      >
        {activeWidgets.map(item => (
          <div key={item.widgetId}>
            <WidgetContainer onRemove={() => removeWidget(item.widgetId)}>
              <ErrorBoundary name={item.widgetType}>
                {renderWidget(item)}
              </ErrorBoundary>
            </WidgetContainer>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
