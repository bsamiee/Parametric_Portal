/**
 * Handle bulk asset import/export HTTP endpoints.
 * Thin HTTP adapter — all business logic lives in TransferService.
 */
import { HttpApiBuilder } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { TransferService } from '@parametric-portal/server/domain/transfer';
import { Effect } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const TransferLive = HttpApiBuilder.group(ParametricApi, 'transfer', (handlers) =>
	Effect.gen(function* () {
		const transfer = yield* TransferService;
		return handlers
			.handleRaw('export', ({ urlParams }) => transfer.exportAssets(urlParams))
			.handle('import', ({ urlParams }) => transfer.importAssets(urlParams));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TransferLive };
