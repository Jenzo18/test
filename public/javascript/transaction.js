window.onload = function () {
  checkRestaurantState();
  toggleDiscountFields();
  fetchLatestOrder('Dasmariñas');
}

document.addEventListener('DOMContentLoaded', function () {
  // Wait for the DOM to be fully loaded before attempting to access elements
  const checkbox = document.getElementById('confirmationCheckbox');
  const placeOrderBtn = document.getElementById('placeOrderBtn');

  placeOrderBtn.disabled = true;

  checkbox.addEventListener('change', function () {
    placeOrderBtn.disabled = !checkbox.checked;
  });
});

// Function to check restaurant state and display overlay
function checkRestaurantState() {
  fetch('/checkRestaurantState')
    .then(response => response.json())
    .then(data => {
      if (data.state === 'Closed') {
        document.getElementById('overlay').style.display = 'block';
      }
    })
    .catch(error => {
      console.error('Error:', error);
    });
}


async function bringBackQuantityInDatabase(itemName, quantity) {
  try {
    const response = await fetch(`/bringBackQuantity?itemName=${itemName}&quantity=${quantity}`, {
      method: 'PUT',
    });

    const data = await response.json();

    console.log(data.message); // Log the message from the server
  } catch (error) {
    console.error('Error bringing back quantity:', error);
    // Handle the error as needed (e.g., show an alert to the user)
  }
}



const username = sessionStorage.getItem('username');
const userId = sessionStorage.getItem('userId');
async function getUserId() {
  try {
    const response = await fetch('/getUserId');
    const data = await response.json();
    return data.userId; // Assuming /getUserId always returns the user ID or null
  } catch (error) {
    console.error('Error fetching user ID:', error);
    return null;
  }
}

let discountApplied = false;
async function applyDiscount() {
  if (discountApplied) {
    return;
  }

  // Get the selected discount option
  const discountSelect = document.getElementById('discount-select');
  const selectedDiscount = discountSelect.value;

  // Get the card name and ID input values
  const cardNameInput = document.getElementById('card-name');
  const cardIdInput = document.getElementById('card-id');
  const cardName = cardNameInput.value;
  const cardId = cardIdInput.value;

  // Get the total price element
  const subtotalelement = document.getElementById('sub-total');
  const currentTotal = parseFloat(subtotalelement.textContent.replace('Php', ''));

  if (!cardName || !cardId) {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Please fill in the name of the card and ID number.',
    });
    return;
  }

  // Calculate the discount amount based on the selected option
  let discountAmount = 0; // Default to no discount

  if (selectedDiscount !== "none") {
    discountAmount = 0.05; // 5% discount for options other than "None"
  }
  const customerDiscount = parseFloat((currentTotal * discountAmount).toFixed(2));

  const response = await fetch('/latestorder');
  const latestOrder = await response.json();
  orderId = latestOrder.orderId;

  try {
    // Update the delivery status to "Delivering" in the "CustomerOrders" collection
    const updateResponse = await fetch('/updateDiscount', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId,
        customerDiscount, // Set the new delivery status here
      }),
    });
    // Rest of your code...
  } catch (error) {
    console.error('Error updating discount:', error);
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'An error occurred while updating the discount.',
    });
  }


  // Set the discountApplied flag to true
  discountApplied = true;

  // Disable the "Apply Discount" button
  const applyDiscountButton = document.querySelector('.confirm-order-btn');
  applyDiscountButton.disabled = true;

  selectedCity = 'Dasmariñas';

  fetchLatestOrder(selectedCity);

  Swal.fire({
    icon: 'success',
    title: 'Success',
    text: 'Discount applied!',
  });
}


// Function to remove the discount
async function resetDiscount() {
  discountApplied = false;
  const applyDiscountButton = document.querySelector('.confirm-order-btn');
  applyDiscountButton.disabled = false;

  const response = await fetch('/latestorder');
  const latestOrder = await response.json();
  orderId = latestOrder.orderId;

  try {

    const updateResponse = await fetch('/updateDiscount', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        orderId,
        customerDiscount: 0.00,
      }),
    });
    // Rest of your code...
  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'An error occurred while updating the discount.',
    });
  }

  selectedCity = 'Dasmariñas';

  fetchLatestOrder(selectedCity);

  Swal.fire({
    icon: 'success',
    title: 'Success',
    text: 'Discount reset!',
  });
}


let latestOrderId = '';
// Add an event listener to the 'city' select element
const citySelect = document.getElementById('city');

citySelect.addEventListener('change', () => {
  const selectedCity = citySelect.options[citySelect.selectedIndex].text.trim();
  fetchLatestOrder(selectedCity); // Call fetchLatestOrder with the selected city
});

async function redirectToMenu() {

  const buyresponse = await fetch('/latestOrder');
  const latestOrder = await buyresponse.json();

  if (latestOrder.cartItems) {
    // Iterate through cartItems and update the quantity in the database
    for (const cartItem of latestOrder.cartItems) {
      await bringBackQuantityInDatabase(cartItem.name, cartItem.quantity);
    }
  }

  window.location.href = '/menu';
}

// Add this function to your JavaScript
function toggleDiscountFields() {
  const discountSelect = document.getElementById('discount-select');
  const cardNameRow = document.getElementById('card-name-row');
  const cardIdRow = document.getElementById('card-id-row');
  const applyDiscountButton = document.querySelector('.confirm-order-btn');
  const resetDiscountButton = document.querySelector('.reset-discount-btn');

  const selectedDiscount = discountSelect.value;

  if (selectedDiscount === 'none') {
    // If "None" is selected, hide the card name and ID fields
    cardNameRow.style.display = 'none';
    cardIdRow.style.display = 'none';

    // Hide the "Apply Discount" button
    applyDiscountButton.style.display = 'none';
    resetDiscountButton.style.display = 'block';
  } else {
    // If any other option is selected, show the card name and ID fields
    cardNameRow.style.display = 'table-row';
    cardIdRow.style.display = 'table-row';

    // Show the "Apply Discount" button
    applyDiscountButton.style.display = 'block';
    resetDiscountButton.style.display = 'none';
  }
}

async function fetchLatestOrder(selectedCity = '') {
  try {
    // Fetch the user ID
    const userId = await getUserId();

    if (!userId) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'User not found. Please login or refresh the page',
      });
      return;
    }

    const [latestOrderResponse, deliveryFeeResponse] = await Promise.all([
      fetch('/latestorder'),
      fetch(`/deliveryfee?location=${selectedCity}`), // Use backticks for interpolation
    ]);

    const latestOrder = await latestOrderResponse.json();
    const deliveryFee = await deliveryFeeResponse.json();

    // Access the table body element
    const dataBody = document.getElementById('order-body');

    // Access the subtotal element
    const subtotalelement = document.getElementById('sub-total');

    const discountElement = document.getElementById('customer-discount');
    const deliveryFeeElement = document.getElementById('delivery-fee');

    // Access the total element
    const totalElement = document.getElementById('total-price');

    // Clear any existing content
    dataBody.innerHTML = '';
    subtotalelement.textContent = ''; // Clear total price
    discountElement.textContent = ''; // Clear total price
    deliveryFeeElement.textContent = 'Php 0.00'; // Set initial delivery fee to 0
    totalElement.textContent = '';

    // Check if the latestOrder is not empty
    if (latestOrder) {
      const orderId = latestOrder.orderId;
      const cartItems = latestOrder.cartItems;
      const customerDiscount = latestOrder.customerDiscount;
      let totalPrice = 0;

      // Loop through the cartItems and create table rows
      cartItems.forEach((item, index) => {
        const row = document.createElement('tr');

        // Create a cell for the item name and quantity (left-aligned)
        const listItemCell = document.createElement('td');
        listItemCell.textContent = `${item.quantity} x ${item.name}`;
        row.appendChild(listItemCell);

        // Create a cell for the price (right-aligned)
        const priceCell = document.createElement('td');
        priceCell.textContent = `Php ${item.price.toFixed(2)}`;
        priceCell.style.textAlign = 'right'; // Align the cell content to the right
        row.appendChild(priceCell);

        dataBody.appendChild(row);

        // Update total price
        totalPrice += item.price * item.quantity;
      });

      // Display the total price at the end of the table
      subtotalelement.textContent = `Php ${totalPrice.toFixed(2)}`;
      totalElement.textContent = `Php ${totalPrice.toFixed(2)}`;

      // Display the customer discount if it's greater than 0 
      if (customerDiscount > 0) {
        discountElement.textContent = `- 5% Php ${customerDiscount.toFixed(2)}`;
        deliveryFeeElement.textContent = `Php ${deliveryFee.deliveryfee.toFixed(2)}`;
        totalElement.textContent `Php ${((totalPrice - customerDiscount) + deliveryFee.deliveryfee).toFixed(2)}`;
      } else {
        discountElement.textContent = `Php ${customerDiscount.toFixed(2)}`;
        deliveryFeeElement.textContent = `Php ${deliveryFee.deliveryfee.toFixed(2)}`;
        totalElement.textContent = `Php ${(totalPrice + deliveryFee.deliveryfee).toFixed(2)}`;
      }
    }
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}

async function buy() {
  try {
    const subtotalelement = parseFloat(document.getElementById('sub-total').textContent.replace('Php', ''));
    const deliveryfee = parseFloat(document.getElementById('delivery-fee').textContent.replace('Php', ''));
    const totalPrice = parseFloat(document.getElementById('total-price').textContent.replace('Php', ''));
    const formattedTotalPrice = totalPrice.toFixed(2);

    const discountSelect = document.getElementById('discount-select');
    const selectedDiscount = discountSelect.value;

    const cardNameInput = document.getElementById('card-name');
    const cardIdInput = document.getElementById('card-id');
    const cardName = cardNameInput.value;
    const cardId = cardIdInput.value;

    // Get selected payment method
    const selectedPaymentMethod = document.querySelector('input[name="payment"]:checked').value;

    const specialinstruction = document.getElementById('additionalmessage').value;

    // If the selected payment method is not GCash, proceed with other payment methods
    const citySelect = document.getElementById('city');
    const barangaySelect = document.getElementById('barangay');
    const streetInput = document.getElementById('street-text');

    const city = citySelect.options[citySelect.selectedIndex].text.trim();
    const barangay = barangaySelect.options[barangaySelect.selectedIndex].text.trim();
    const street = streetInput.value.trim();

    if (!city || !barangay || !street) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: 'Please select all location fields.',
      });
      return;
    }

    const location = `${'REGION IV-A'}, ${'Cavite'}, ${city}, ${barangay}, ${street}`;
    const buyresponse = await fetch('/latestorder');
    const latestOrder = await buyresponse.json();

    const userId = latestOrder.userId;
    const orderId = latestOrder.orderId;
    const orderItems = latestOrder.cartItems;
    const customerDiscount = latestOrder.customerDiscount;
    const username = latestOrder.username;
    const user_email = latestOrder.email;
    const user_phone = latestOrder.phone;

    const order = {
      userId,
      orderId,
      items: orderItems,
      location,
      discount: {
        SelectedDiscount: selectedDiscount,
        CardName: cardName,
        CardId: cardId,
        CustomerDiscount: customerDiscount,
      },
      totalprice: {
        Subtotal: subtotalelement,
        DeliveryFee: deliveryfee,
        Discount: customerDiscount,
        Total: formattedTotalPrice,
      },
      paymentmethod: selectedPaymentMethod,
      deliverystatus: "Pending",
      specialinstruction,
    };

    const formattedOrderDetails = `
    <p class="transactionp"><strong>Order Details:</strong></p>
    <div style="text-align: left; white-space: pre-wrap;">
      <strong>Order ID:</strong> ${order.orderId}
      <strong>Items:</strong> 
        ${order.items.map(item => `
          - ${item.name} x${item.quantity} - Php ${item.price * item.quantity}
        `).join('\n')}
      <strong>Location:</strong> ${order.location}
      <br>
      <strong>Discount:</strong> ${order.discount.SelectedDiscount === 'none' ? 'None' : order.discount.SelectedDiscount}
      <strong>Total Price:</strong> 
        Subtotal: Php ${order.totalprice.Subtotal}
        Delivery Fee: Php ${order.totalprice.DeliveryFee}
        Discount: Php ${order.totalprice.Discount} 5%
        Total: Php ${order.totalprice.Total}
      <strong>Payment Method:</strong> ${order.paymentmethod}
      <strong>Special Instruction:</strong> ${order.specialinstruction || 'None'}
    </div>
  `;

    // Show a confirmation modal before executing the await function
    const confirmResult = await Swal.fire({
      title: 'Confirm Order',
      html: formattedOrderDetails,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Place Order',
      cancelButtonText: 'Cancel',
    });

    if (confirmResult.isConfirmed) {
      if (selectedPaymentMethod === 'E-Wallet') {
        const buxRequest = {
          req_id: orderId,
          client_id: '000001fca3',
          amount: formattedTotalPrice,
          description: 'Bahay Pares Tapsihan Online Order Payment',
          expiry: 2,
          email: user_email,
          contact: user_phone,
          name: username,
          notification_url: 'https://bahayparestapsihandasma.vercel.app/notification_url/',
          redirect_url: 'https://bahayparestapsihandasma.vercel.app/Vieworder',
          enabled_channels: ["grabpay", "gcash", "BPIA", "RCBC", "UBPB"],
        };

        const buxCheckoutResponse = await fetch('/open/checkout/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buxRequest),
        });

        console.log(buxCheckoutResponse.status);

        const buxData = await buxCheckoutResponse.json();
        const buxCheckoutUrl = buxData.url; // Use the received URL

        fetch('/storePendingOrder', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(order),
        });


        fetch('/sendorderemail', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(order),
        });

        // Open the Bux checkout page in a new tab
        window.location.href = buxCheckoutUrl;
      } else {
        // Execute the await function if the user confirms
        const response = await fetch('/storeOrder', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(order),
        });


        const emailresponse = fetch('/sendorderemail', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(order),
        });

        if (response.ok) {
          console.log('Order data stored successfully.');
          Swal.fire({
            icon: 'success',
            title: 'Order Placed Successfully',
            text: 'Thank you for your order!',
          });
          window.location.href = '/Vieworder';
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Error occurred while placing the order. Please try again.',
          });
        }
      }

    }
  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'Notice',
      text: 'Please make sure that all fields has been filled',
    });
  }
}


//LOGOUT FUNCTION
document.addEventListener('DOMContentLoaded', function () {
  const logoutButton = document.getElementById('logoutButton');
  const Profile = document.getElementById('profileIcon');

  // Check if the user is authenticated by making a GET request to a route that
  // returns the user information when authenticated
  fetch('/check-auth', {
      method: 'GET',
    })
    .then(response => response.json())
    .then(data => {
      if (data.isAuthenticated) {
        logoutButton.style.display = 'block';
        Profile.style.display = 'block';

        // Add a click event listener to the logout button
        logoutButton.addEventListener('click', function () {
          // Display a confirmation dialog
          const isConfirmed = window.confirm('Are you sure you want to logout?');

          // Check if the user confirmed the logout
          if (isConfirmed) {
            // Send a logout request to the server when confirmed
            fetch('/logout', {
                method: 'GET',
              })
              .then(response => response.json())
              .then(data => {
                if (data.message === 'Logout successful') {
                  // Redirect to the login page or another page after logout
                  window.location.href = '/';
                } else {
                  console.error('Logout failed:', data.error);
                }
              })
              .catch(error => {
                console.error('Error during logout:', error);
              });
          }
        });
      } else {
        Profile.style.display = 'none';
        logoutButton.style.display = 'none';
      }
    })
    .catch(error => {
      console.error('Error checking authentication:', error);
    });
});