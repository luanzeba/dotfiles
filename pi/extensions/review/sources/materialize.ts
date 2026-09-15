/**
 * Turn a remote commit into a local folder the reviewer can read.
 *
 * This module exists so remote review has exactly one deterministic path, and so the
 * isolation guarantee lives in one place:
 *
 *   The user's working tree is never read, never modified, and never confused with the
 *   code under review.
 *
 * That path is an authenticated snapshot of the head commit. The caller has already made
 * several API calls by the time it gets here, so the credentials are known to work, and a
 * snapshot cannot reach the user's checkout even accidentally.
 *
 * Folders are cached by commit, so re-reviewing the same head costs nothing and a force-push
 * naturally produces a fresh folder.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecFn } from "./types";

export interface Materialized {
	folder: string;
	cleanup?: () => Promise<void>;
}

export function cacheRoot(): string {
	return path.join(os.homedir(), ".cache", "pi-review");
}

function cacheDir(host: string, project: string, headSha: string): string {
	const safeProject = project.replace(/[^\w.-]+/g, "-");
	return path.join(cacheRoot(), host, safeProject, headSha);
}

/** A previously unpacked snapshot for this exact commit, if one is already on disk. */
export async function cachedSnapshot(
	host: string,
	project: string,
	headSha: string,
): Promise<Materialized | null> {
	const destination = cacheDir(host, project, headSha);
	try {
		const entries = await fs.readdir(destination);
		return entries.length > 0 ? { folder: destination } : null;
	} catch {
		return null;
	}
}

/** Unpack a snapshot tarball the caller downloaded. */
export async function unpackTarball(
	tarballPath: string,
	host: string,
	project: string,
	headSha: string,
	exec: ExecFn,
): Promise<Materialized> {
	const destination = cacheDir(host, project, headSha);
	await fs.mkdir(destination, { recursive: true });
	// Snapshot tarballs wrap everything in a single "<project>-<sha>" directory.
	const extracted = await exec("tar", ["-xzf", tarballPath, "-C", destination, "--strip-components=1"], {
		timeout: 300_000,
	});
	if (extracted.code !== 0) {
		throw new Error(`could not unpack snapshot: ${extracted.stderr.trim() || "tar failed"}`);
	}
	return { folder: destination };
}
