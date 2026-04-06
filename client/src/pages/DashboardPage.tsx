import { WidgetGrid } from '../components/dashboard/WidgetGrid';
import { useMonitoring } from '../context/MonitoringContext';

export function DashboardPage() {
  const { selectedDate, setSelectedDate } = useMonitoring();

  return (
    <div className="p-4 h-full">
      <WidgetGrid selectedDate={selectedDate} onDateChange={setSelectedDate} />
    </div>
  );
}
