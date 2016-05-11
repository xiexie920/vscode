/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TPromise } from 'vs/base/common/winjs.base';
import { IRawGitService, RawServiceState } from 'vs/workbench/parts/git/common/git';
import { NoOpGitService } from 'vs/workbench/parts/git/common/noopGitService';
import { GitService } from 'vs/workbench/parts/git/browser/gitServices';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { IOutputService } from 'vs/workbench/parts/output/common/output';
import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEventService } from 'vs/platform/event/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IMessageService } from 'vs/platform/message/common/message';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { getDelayedChannel } from 'vs/base/parts/ipc/common/ipc';
import { Client } from 'vs/base/parts/ipc/node/ipc.cp';
import { GitChannelClient, UnavailableGitChannel } from 'vs/workbench/parts/git/common/gitIpc';
import { RawGitService } from 'vs/workbench/parts/git/node/rawGitService';
import URI from 'vs/base/common/uri';
import { spawn, exec } from 'child_process';
import { join } from 'path';
import { remote } from 'electron';
import { IStorageService } from 'vs/platform/storage/common/storage';

interface IGit {
	path: string;
	version: string;
}

function parseVersion(raw: string): string {
	return raw.replace(/^git version /, '');
}

function findSpecificGit(path: string): TPromise<IGit> {
	return new TPromise<IGit>((c, e) => {
		const buffers: Buffer[] = [];
		const child = spawn(path, ['--version']);
		child.stdout.on('data', b => buffers.push(b));
		child.on('error', e);
		child.on('exit', code => code ? e(new Error('Not found')) : c({ path, version: parseVersion(Buffer.concat(buffers).toString('utf8').trim()) }));
	});
}

function findGitDarwin(): TPromise<IGit> {
	return new TPromise<IGit>((c, e) => {
		exec('which git', (err, gitPathBuffer) => {
			if (err) {
				return e('git not found');
			}

			const path = gitPathBuffer.toString().replace(/^\s+|\s+$/g, '');

			function getVersion(path: string) {
				// make sure git executes
				exec('git --version', (err, stdout) => {
					if (err) {
						return e('git not found');
					}

					return c({ path, version: parseVersion(stdout.toString('utf8').trim()) });
				});
			}

			if (path !== '/usr/bin/git')	{
				return getVersion(path);
			}

			// must check if XCode is installed
			exec('xcode-select -p', (err: any) => {
				if (err && err.code === 2) {
					// git is not installed, and launching /usr/bin/git
					// will prompt the user to install it

					return e('git not found');
				}

				getVersion(path);
			});
		});
	});
}

function findSystemGitWin32(base: string): TPromise<IGit> {
	if (!base) {
		return TPromise.wrapError('Not found');
	}

	return findSpecificGit(join(base, 'Git', 'cmd', 'git.exe'));
}

function findGitWin32(): TPromise<IGit> {
	return findSystemGitWin32(process.env['ProgramW6432'])
		.then(null, () => findSystemGitWin32(process.env['ProgramFiles(x86)']))
		.then(null, () => findSystemGitWin32(process.env['ProgramFiles']))
		.then(null, () => findSpecificGit('git'));
}

function findGit(hint: string): TPromise<IGit> {
	var first = hint ? findSpecificGit(hint) : TPromise.wrapError(null);

	return first.then(null, () => {
		switch (process.platform) {
			case 'darwin': return findGitDarwin();
			case 'win32': return findGitWin32();
			default: return findSpecificGit('git');
		}
	});
}

class UnavailableRawGitService extends RawGitService {
	constructor() {
		super(null);
	}

	serviceState(): TPromise<RawServiceState> {
		return TPromise.as(RawServiceState.GitNotFound);
	}
}

class DisabledRawGitService extends RawGitService {
	constructor() {
		super(null);
	}

	serviceState(): TPromise<RawServiceState> {
		return TPromise.as(RawServiceState.Disabled);
	}
}

export class ElectronGitService extends GitService {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IEventService eventService: IEventService,
		@IMessageService messageService: IMessageService,
		@IWorkbenchEditorService editorService: IWorkbenchEditorService,
		@IOutputService outputService: IOutputService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IStorageService storageService: IStorageService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		const conf = configurationService.getConfiguration<any>();
		const enabled = conf.git ? conf.git.enabled : true;
		const workspace = contextService.getWorkspace();

		let raw: IRawGitService;

		if (!enabled) {
			raw = new DisabledRawGitService();
		} else if (!workspace) {
			raw = new NoOpGitService();
		} else {
			const gitPath = (conf.git && conf.git.path) || null;
			const encoding = (conf.files && conf.files.encoding) || 'utf8';
			const workspaceRoot = workspace.resource.fsPath;

			const promise = TPromise.timeout(0) // free event loop cos finding git costs
				.then(() => findGit(gitPath))
				.then(({ path, version }) => {
					const client = new Client(
						URI.parse(require.toUrl('bootstrap')).fsPath,
						{
							serverName: 'Git',
							timeout: 1000 * 60,
							args: [path, workspaceRoot, encoding, remote.process.execPath, version],
							env: {
								ATOM_SHELL_INTERNAL_RUN_AS_NODE: 1,
								PIPE_LOGGING: 'true',
								AMD_ENTRYPOINT: 'vs/workbench/parts/git/node/gitApp'
							}
						}
					);

					return client.getChannel('git');
				})
				.then(null, () => new UnavailableGitChannel());

			const channel = getDelayedChannel(promise);
			raw = new GitChannelClient(channel);
		}

		super(raw, instantiationService, eventService, messageService, editorService, outputService, contextService, lifecycleService, storageService);
	}
}
