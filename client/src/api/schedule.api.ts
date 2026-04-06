import { apiClient } from './client';
import { ScheduleData, ScheduleHistoryData, ScheduleRow, ScheduleSlotRevision } from '@smartpulse-intl/shared';

export const scheduleApi = {
  async readSchedule(plantId: number, dateKey?: string): Promise<ScheduleData> {
    const { data } = await apiClient.post('/schedule/read', { plantId, dateKey });
    return data;
  },

  async readHistory(plantId: number, dateKey?: string): Promise<ScheduleHistoryData> {
    const { data } = await apiClient.post('/schedule/history', { plantId, dateKey });
    return data;
  },

  async saveSchedule(plantId: number, header: string[], rows: ScheduleRow[]): Promise<{ message: string }> {
    const { data } = await apiClient.post('/schedule/save', { plantId, header, rows });
    return data;
  },

  async getSlotHistory(plantId: number, deliveryStart: string): Promise<ScheduleSlotRevision[]> {
    const { data } = await apiClient.post('/schedule/slot-history', { plantId, deliveryStart });
    return data.revisions;
  },

  async exportVersionedHistory(plantId: number, dateKey: string): Promise<void> {
    const response = await apiClient.post('/schedule/export-versioned', { plantId, dateKey }, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule_${plantId}_${dateKey}_versioned.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
};
