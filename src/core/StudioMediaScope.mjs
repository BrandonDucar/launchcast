/** Bounded, process-local scan provenance for the single-user Studio, not authentication. */
export class StudioMediaScope {
  constructor() {
    this.assets = new Map();
  }

  register(root, mediaAssets) {
    for (const asset of mediaAssets.slice(0, 100)) {
      this.assets.delete(asset.path);
      this.assets.set(asset.path, root);
    }
    while (this.assets.size > 1000) this.assets.delete(this.assets.keys().next().value);
  }

  rootsFor(storyboard) {
    const roots = new Set();
    for (const beat of storyboard.beats) {
      if (!beat.mediaAsset) continue;
      const root = this.assets.get(beat.mediaAsset);
      if (!root) throw new Error("Media was not discovered by this Studio; scan its repository again");
      roots.add(root);
    }
    return [...roots];
  }
}
