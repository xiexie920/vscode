/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {TPromise} from 'vs/base/common/winjs.base';
import {IDisposable} from 'vs/base/common/lifecycle';
import {ITimerEvent, nullEvent} from 'vs/base/common/timer';
import {createDecorator, ServiceIdentifier} from 'vs/platform/instantiation/common/instantiation';

export const ITelemetryService = createDecorator<ITelemetryService>('telemetryService');

export interface ITelemetryInfo {
	sessionId: string;
	machineId: string;
	instanceId: string;
}

export interface ITelemetryService {
	serviceId: ServiceIdentifier<any>;

	/**
	 * Sends a telemetry event that has been privacy approved.
	 * Do not call this unless you have been given approval.
	 */
	publicLog(eventName: string, data?: any): any;

	/**
	 * Starts a telemetry timer. Call stop() to send the event.
	 */
	timedPublicLog(name: string, data?: any): ITimerEvent;

	getTelemetryInfo(): TPromise<ITelemetryInfo>;

	isOptedIn: boolean;
}

export const NullTelemetryService: ITelemetryService = {
	serviceId: undefined,
	timedPublicLog(name: string, data?: any): ITimerEvent { return nullEvent; },
	publicLog(eventName: string, data?: any): void { },
	isOptedIn: true,
	getTelemetryInfo(): TPromise<ITelemetryInfo> {
		return TPromise.as({
			instanceId: 'someValue.instanceId',
			sessionId: 'someValue.sessionId',
			machineId: 'someValue.machineId'
		});
	}
};

export interface ITelemetryAppender extends IDisposable {
	log(eventName: string, data?: any): any;
}

// --- util

export function anonymize(input: string): string {
	if (!input) {
		return input;
	}

	let r = '';
	for (let i = 0; i < input.length; i++) {
		let ch = input[i];
		if (ch >= '0' && ch <= '9') {
			r += '0';
			continue;
		}
		if (ch >= 'a' && ch <= 'z') {
			r += 'a';
			continue;
		}
		if (ch >= 'A' && ch <= 'Z') {
			r += 'A';
			continue;
		}
		r += ch;
	}
	return r;
}