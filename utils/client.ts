import { browser } from 'wxt/browser';
import type { Message, Response } from './model';

export async function sendRequest<T>(request: Message): Promise<T> {
  const response = await browser.runtime.sendMessage(request) as Response<T> | undefined;
  if (!response || typeof response.ok !== 'boolean') {
    throw new Error('Tab tidy did not respond. Try again.');
  }
  if (!response.ok) throw new Error(response.error);
  return response.data;
}
