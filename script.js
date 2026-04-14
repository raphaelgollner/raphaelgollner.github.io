// Adicionando um pequeno efeito de interatividade no console
document.addEventListener("DOMContentLoaded", () => {
    console.log("Sistemas online. Shields ativados. Portfólio carregado com sucesso!");
    
    // Efeito suave de entrada para os cards (fade-in)
    const cards = document.querySelectorAll('.card');
    cards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.animation = `fadeIn 0.5s ease forwards ${index * 0.2}s`;
    });
});