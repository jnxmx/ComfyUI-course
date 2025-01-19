document.addEventListener('DOMContentLoaded', () => {
    console.log('Page loaded.');

    // If using IntersectionObserver, ensure styles are intentional and consistent
    const sections = document.querySelectorAll('section');
    const options = {
        root: null,
        threshold: 0.1,
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.backgroundColor = 'transparent'; // Ensure background is transparent
            } else {
                entry.target.style.backgroundColor = 'transparent'; // Reset to transparent
            }
        });
    }, options);

    sections.forEach(section => {
        observer.observe(section);
    });
});
