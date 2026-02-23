// Fixed JavaScript file: gerencial_por_vendedor_html.js

// Assuming this file contains functions to manage data on sales by vendor

function fetchData() {
    // Fetch data from the server
    fetch('api/sales')
        .then(response => response.json())
        .then(data => updateUI(data))
        .catch(error => console.error('Error fetching data:', error));
}

function updateUI(data) {
    // Update the user interface with fetched data
    const container = document.getElementById('data-container');
    container.innerHTML = '';
    data.forEach(sale => {
        const saleElement = document.createElement('div');
        saleElement.innerText = `Vendor: ${sale.vendor}, Amount: ${sale.amount}`;
        container.appendchild(saleElement);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    fetchData();
});