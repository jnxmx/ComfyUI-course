document.addEventListener('DOMContentLoaded', () => {
    console.log('Page loaded.');

    // Example of potential future interactivity:
    // Highlight active section based on scroll position
    const sections = document.querySelectorAll('section');
    const options = {
        root: null,
        threshold: 0.1,
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.backgroundColor = '#f9f9f9';
            } else {
                entry.target.style.backgroundColor = '';
            }
        });
    }, options);

    sections.forEach(section => {
        observer.observe(section);
    });
});
