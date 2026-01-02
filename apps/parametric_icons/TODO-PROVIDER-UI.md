# Provider Selection UI - Implementation Reminder

## Summary

Backend multi-provider AI support (anthropic/openai/gemini) is complete. Frontend needs UI to let users select their preferred provider.

## Backend Status

- `packages/ai/src/registry.ts` - Provider dispatch table with 3 providers
- `apps/api/src/contracts/icons.ts` - GenerateRequestSchema accepts `provider` field
- `apps/api/src/routes/icons.ts` - Routes provider parameter to service
- `apps/api/src/services/icons.ts` - Dynamic provider selection via registry

## Frontend Changes Required

### 1. Add Provider Dropdown to Generation Form

Location: Component that calls `icons.generate()`

```typescript
// Add to generation request
const [provider, setProvider] = useState<'anthropic' | 'openai' | 'gemini'>('anthropic');

// Include in API call
icons.generate({ prompt, provider, variantCount });
```

### 2. Update Stores (if needed)

Location: `apps/parametric_icons/src/stores.ts`

- Add `selectedProvider` to generation state
- Persist user preference

### 3. UI Component

- Dropdown/radio group with provider options
- Show provider name and model info
- Persist selection in localStorage or user preferences

## Provider Info

| Provider  | Default Model            | Notes          |
| --------- | ------------------------ | -------------- |
| anthropic | claude-sonnet-4-20250514 | Best quality   |
| openai    | gpt-4o                   | Fast           |
| gemini    | gemini-2.0-flash         | Cost-effective |

## Type Reference

```typescript
// From packages/types/src/database.ts
type AiProvider = 'anthropic' | 'gemini' | 'openai';

// From apps/api/src/contracts/icons.ts
GenerateRequestSchema: {
    provider?: 'anthropic' | 'openai' | 'gemini';
    // ... other fields
}
```
