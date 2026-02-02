/**
 * @file compatibility.ts
 * @description Runtime diagnostic utility for Figma Environment Alignment.
 * 
 * [NOTE]: Environmental guards are now injected at the bundle level via build.js
 * to bypass module hoisting issues. This utility provides extended diagnostics.
 */

import { RemoteLogger } from './remoteLogger';

export interface CompatibilityAudit {
    ok: boolean;
    missingFeatures: string[];
    isShimmed: boolean;
}

/**
 * Robustly resolves the global object.
 */
function getGlobal(): any {
    if (typeof globalThis !== 'undefined') return globalThis;
    if (typeof self !== 'undefined') return self;
    if (typeof window !== 'undefined') return window;
    if (typeof global !== 'undefined') return global;
    return (function(this: any) { return this; })() || {};
}

/**
 * Performs a deep audit of the environment features.
 */
export function auditEnvironment(): CompatibilityAudit {
    const missing: string[] = [];
    const g = getGlobal();

    // 1. Check for ES2018+ features
    if (typeof Object.fromEntries !== 'function') missing.push('Object.fromEntries');
    if (typeof Promise.prototype.finally !== 'function') missing.push('Promise.finally');

    return {
        ok: missing.length === 0,
        missingFeatures: missing,
        isShimmed: !!(g.__ENVIRONMENT_SHIM_ACTIVE__)
    };
}

/**
 * Initialize diagnostics and log report.
 */
export function initializeDiagnostics(): void {
    // Initialize Remote Logging for Dev
    RemoteLogger.init();

    const audit = auditEnvironment();
    const g = getGlobal();

    // Persist for runtime introspection
    try {
        g.__GENABLE_DIAGNOSTICS__ = audit;
    } catch (e) { /* ignore */ }

    if (!audit.ok) {
        console.log(`[Genable] Environment Audit: ${audit.ok ? 'PASSED' : 'DEGRADED'}`);
        if (audit.missingFeatures.length > 0) {
            console.warn(`[Genable] Missing/Broken Features: ${audit.missingFeatures.join(', ')}`);
        }
    }
}

// Side-effect to ensure diagnostics are registered.
initializeDiagnostics();
