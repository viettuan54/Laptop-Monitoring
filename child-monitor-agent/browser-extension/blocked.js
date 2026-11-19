document.getElementById('host').textContent = new URLSearchParams(location.hash.slice(1)).get('host') || '';
