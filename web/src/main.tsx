// React islands entry (ES module: runs after the legacy scripts). The island
// runtime (registry + mounting) arrives in F6; lazy panels load as chunks.
import './main.css';
import type {} from './bootstrap.ts';

window.FinSight.markIslandsReady();
