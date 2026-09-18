const SAVE_KEY = "cfs-save-v1";

function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function writeSave(data) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; } }
function readSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
