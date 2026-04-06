import axios from 'axios';
import { PORTAL_BASE_URLS } from '../config/env';

export class FtpService {
  async readFile(
    cookies: string[],
    env: string,
    direction: 'incoming' | 'outgoing',
    filename: string
  ): Promise<string> {
    const baseUrl = PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;

    const url = `${baseUrl}/Ftp/GetFileData`;
    console.log(`[FTP] GET ${url} direction=${direction} name=${filename}`);

    const response = await axios.get(url, {
      params: {
        direction,
        name: filename,
      },
      headers: {
        Cookie: cookies.join('; '),
      },
      timeout: 15_000,
    });

    console.log(`[FTP] Response status=${response.status} keys=${Object.keys(response.data || {}).join(',')}`);
    return response.data?.FileData || response.data?.fileData || '';
  }

  async getFileWithMeta(
    cookies: string[],
    env: string,
    direction: 'incoming' | 'outgoing',
    filename: string
  ): Promise<any> {
    const baseUrl = PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;
    const url = `${baseUrl}/Ftp/GetFileData`;

    console.log(`[FTP] GET_META ${url} direction=${direction} name=${filename}`);
    const response = await axios.get(url, {
      params: { direction, name: filename },
      headers: { Cookie: cookies.join('; ') },
      timeout: 15_000,
    });

    return response.data;
  }

  async saveFile(
    cookies: string[],
    env: string,
    direction: 'incoming' | 'outgoing',
    filename: string,
    data: string
  ): Promise<string> {
    const baseUrl = PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;

    // New API expects base64-encoded UTF-8 bytes
    const dataBin = Buffer.from(data, 'utf-8').toString('base64');

    const response = await axios.post(
      `${baseUrl}/Ftp/SaveFile`,
      {
        direction,
        name: filename,
        dataBin,
      },
      {
        headers: {
          Cookie: cookies.join('; '),
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      }
    );

    return response.data?.FileName ? 'File saved' : (response.data?.Error || 'File saved');
  }

  async listFiles(
    cookies: string[],
    env: string,
    direction: 'incoming' | 'outgoing',
    directoryPattern: string = 'Current',
    nameContains: string = '',
    shouldFetchFileData: boolean = false
  ): Promise<any[]> {
    const baseUrl = PORTAL_BASE_URLS[env] || PORTAL_BASE_URLS.prod;
    const url = `${baseUrl}/Ftp/GetFiles`;

    console.log(`[FTP] GET ${url} direction=${direction} dir=${directoryPattern} name=${nameContains} fetch=${shouldFetchFileData}`);

    const response = await axios.get(url, {
      params: {
        direction,
        name: nameContains,
        directoryPattern: directoryPattern || undefined,
        shouldFetchFileData,
      },
      headers: {
        Cookie: cookies.join('; '),
      },
      timeout: 30_000,
    });

    return response.data || [];
  }
}

