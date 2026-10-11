# Gym tracker

A mobile-first photo journal for keeping a short note with each moment.

## Run locally

Open `index.html` in a browser. The page is static and does not need a build step.
Use the gallery button to choose a photo or the camera button to take one, add a
note, then confirm to save the workout in that browser's IndexedDB storage.
Photos are center-cropped to the card shape and converted to a size-optimized
WebP before they are saved.
Select a saved card to review it, tap its note to edit it, or use the delete
button to remove the workout.

Saved photos and notes are stored locally in the browser on this device; they
remain available after refreshing or reopening the site, but are not synced to
other devices. Clearing the browser's site data removes them.

## Deploy to GitHub Pages

The `Deploy to GitHub Pages` workflow publishes the repository root whenever a
commit is pushed to `main` (or when the workflow is run manually). In the
repository settings, set **Pages → Build and deployment → Source** to **GitHub
Actions**. Once the first workflow run succeeds, the published URL appears in
the workflow's `github-pages` environment.
