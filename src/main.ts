import './styles.css';

// Keep the original, independently playable feasibility demo available.
if (new URLSearchParams(location.search).has('prototype')) void import('./prototype');
else void import('./trust');
