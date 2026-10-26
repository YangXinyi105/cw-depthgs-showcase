const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if(reduce){document.querySelectorAll('.reveal').forEach(el=>el.classList.add('visible'));}
else{const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}}),{threshold:.12});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));}
