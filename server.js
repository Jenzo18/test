const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const session = require('express-session');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

require('dotenv').config();

const app = express();
const port = 3000;

// Connection URL and Database Name
const url = process.env.MONGODB_URI;
const dbName =  process.env.dbName;
const collectionName = process.env.collectionName;
const collectionAdmin = process.env.collectionAdmin; 
const collectionSuperAdmin = process.env.collectionSuperAdmin; 
const collectionMenu = process.env.collectionMenu;


const storage = multer.memoryStorage();
const upload = multer({
  storage: storage
});

app.use(bodyParser.json());


const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

const mongoClient = new MongoClient(url, options);

(async () => {
  const client = await mongoClient.connect();
  const db = client.db(dbName);
  const collection = db.collection(collectionMenu);

  // Create an index on the "category" field
  await collection.createIndex({ category: 1 });

  client.close();
})();

let db;

async function connectToDatabase() {
  const client = await MongoClient.connect(url, options);
  db = client.db(dbName);
}

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

app.use(express.static(path.join(__dirname, 'public')))

const MongoDBStore = require('connect-mongodb-session')(session);

const store = new MongoDBStore({
  uri: url,
  databaseName: dbName,
  collection: 'sessions',
});

store.on('error', function (error) {
  console.error('Session store error:', error);
});

app.use(
  session({
    secret: process.env.secret,
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      maxAge: 3600000, //Expire in 1 hour
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(
  async (email, password, done) => {
    try {
        // Check if the user is a super admin
        const superAdminAccount = await db.collection(collectionSuperAdmin).findOne({ email });

        if (superAdminAccount) {
          const isPasswordMatch = await bcrypt.compare(password, superAdminAccount.password);
          if (isPasswordMatch) {
            console.log('Super Admin login successful:', superAdminAccount);
            return done(null, { ...superAdminAccount, isSuperAdmin: true });
          } else {
            console.log('Incorrect password for the super admin account.');
            return done(null, false, { message: 'Incorrect username or password' });
          }
      } else {
        // Check if the user is an admin
        const adminAccount = await db.collection(collectionAdmin).findOne({ email });

        if (adminAccount) {                            
          const isPasswordMatch = await bcrypt.compare(password, adminAccount.password);
          if (isPasswordMatch) {
            console.log('Admin login successful:', adminAccount);
            return done(null, { ...adminAccount, isAdmin: true });
          } else {
            console.log('Incorrect password for the admin account.');
            return done(null, false, { message: 'Incorrect username or password' });
          }
        } else {
          // If not an admin, check the regular user collection
          const userAccount = await db.collection(collectionName).findOne({ email });
        
          if (userAccount) {
            if (userAccount.verified) {
              const isPasswordMatch = await bcrypt.compare(password, userAccount.password);
              if (isPasswordMatch) {
                console.log('User login successful:', userAccount);
                return done(null, userAccount);
              } else {
                const errorMessage = 'Incorrect username or password';
                return done(null, false, { message: errorMessage });
              }
            } else {
              const errorMessage = 'User is not yet verified';
              return done(null, false, { message: errorMessage });
            }
          } else {
            const errorMessage = 'No account found with the provided email';
            return done(null, false, { message: errorMessage });
          }
        }               
      }
    } catch (err) {
      console.error('Error during login:', err);
      return done(err);
    }
  }
));


passport.serializeUser((user, done) => {
  done(null, user); // Serialize the entire user object
});

passport.deserializeUser((user, done) => {
  done(null, user); // Deserialize the entire user object
});

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next(); // User is authenticated, proceed to the next middleware
  }
  
  // Redirect to the login page with a message
  res.redirect('/?message=Please login to access this page'); 
}

app.get('/check-user-type', async (req, res) => {
  const { username } = req.query;

  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch data from MongoDB where 'passport.user.username' is equal to the provided username
    const session = await db.collection('sessions').findOne({ 'session.passport.user.username': username });

    // Check if the session and user exist
    if (session && session.session && session.session.passport && session.session.passport.user) {
      // Send the user type as JSON response
      res.status(200).json({ userType: session.session.passport.user.userType });
    } else {
      res.status(404).json({ error: 'User not found' });
    }

  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});

const roleAccess = {
  Cashier: {
    allowedURLs: ['/Updateorder', '/OrderHistory', '/AdminProfile'],
  },
  KitchenPersonnel: {
    allowedURLs: ['/Updateorder', '/menucustomization', '/AdminProfile'],
  },
  DeliveryPerson: {
    allowedURLs: ['/Updateorder', '/AdminProfile'],
  },
  isSuperAdmin: {
    allowedURLs: ['/Updateorder', '/menucustomization', '/OrderHistory', '/superadmin'],
  },
};

function roleBasedAccess(req, res, next) {
  const userRole = req.user && req.user.isSuperAdmin ? 'isSuperAdmin' : req.user && req.user.userType;
  const requestedURL = req.originalUrl;

  if (roleAccess[userRole] && roleAccess[userRole].allowedURLs.includes(requestedURL)) {
    next(); // User is allowed to access this URL
  } else {
    // Show an alert dialog to the user
    res.send(`
  <script>
    alert("Sorry, your account does not have permission to access this page. If you believe this is an error or if you need access to this page, please contact our support team for assistance.\\n\\nContact Support:\\n\\nEmail: support@yourwebsite.com\\nPhone: +1-800-123-4567\\n\\nThank you for your understanding.");
    history.back();
  </script>
`);

  }
}


app.get('/', (req, res) => {
  const message = req.query.message || ''; // Get the message from the query string
  res.sendFile(path.join(__dirname, '/views/index.html'));
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ message: 'Logout error' });
    }
    
    // Optionally, you can add a logout message to the session
    req.session.logoutMessage = 'You have been logged out successfully.';
    
    res.status(200).json({
      message: 'Logout successful',
    });
  });
});

app.get('/check-auth', (req, res) => {
  if (req.isAuthenticated()) {
    // User is authenticated
    res.json({ isAuthenticated: true });
  } else {
    // User is not authenticated
    res.json({ isAuthenticated: false });
  }
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '/views/register.html'));
});

app.get('/policy', (req, res) => {
  res.sendFile(path.join(__dirname, '/views/policy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '/views/termsandcondition.html'));
});

app.get('/resetPassword', (req, res) => {
  res.sendFile(path.join(__dirname, '/views/resetPassword.html'));
});

app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, '/views/menu.html'));
});

app.get('/ContactUs', (req, res) => {
  res.sendFile(path.join(__dirname, '/views/ContactUs.html'));
});

app.get('/AboutUs', (req, res) => {
  res.sendFile(path.join(__dirname, '/views/AboutUs.html'));
});

app.get('/superadmin', isAuthenticated, roleBasedAccess, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/superadmin.html'));
});

app.get('/transactionpage.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/transactionpage.html'));
});

app.get('/Vieworder', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/ViewOrderStatus.html'));
});

app.get('/Updateorder', isAuthenticated, roleBasedAccess, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/UpdateOrderStatus.html'));
});

app.get('/menucustomization', isAuthenticated, roleBasedAccess, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/menucustomization.html'));
});

app.get('/OrderHistory', isAuthenticated, roleBasedAccess, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/OrderHistory.html'));
});

app.get('/Profile', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/Profile.html'));
});

app.get('/AdminProfile', isAuthenticated, roleBasedAccess, (req, res) => {
  res.sendFile(path.join(__dirname, '/views/AdminProfile.html'));
});

app.use(async (req, res, next) => {
  if (!db) {
    try {
      const client = await MongoClient.connect(url, options);
      db = client.db(dbName);
      req.db = db; // Attach the database instance to the request object
    } catch (err) {
      console.error('Error connecting to MongoDB:', err);
      return res.status(500).send('Internal Server Error');
    }
  } else {
    req.db = db; // Attach the existing database instance to the request object
  }
  next();
});

app.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (!user) {
      return res.status(401).json({ message: info.message || 'Authentication failed' });
    }

    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      let redirectTo = '/menu';

      if (user.isSuperAdmin) {
        redirectTo = '/superadmin';
      }

      if (user.isAdmin) {
        redirectTo = '/Updateorder';
      }

      res.status(200).json({
        message: 'Login successful',
        username: user.username,
        user: user,
        redirectTo: redirectTo,
      });
    });
  })(req, res, next);
});


// Insert route
app.post('/insert', async (req, res) => {
  const {
    username,
    email,
    password,
    userId,
    phone
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const existingUser = await db.collection(collectionName).findOne({
      $or: [
        { username },
        { email },
        { phone }
      ]
    });

    if (existingUser) {
      console.log('User with the same username or email already exists.');
      return res.status(400).json({
        error: 'A user with the same username or email already exists.'
      });
    }

    // Hash the password using bcrypt
    const hashedPassword = await hashPassword(password);

    const verificationToken = generateRandomToken(32);

    // Store the verification token in the database along with a timestamp for expiration
    await db.collection(collectionName).insertOne({
      username,
      email,
      password: hashedPassword,
      userId,
      phone,
      verificationToken,
      verificationTokenExpires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours validity
      verified: false, // Set initially to false
    });

    // Send an email to the user with a verification link that includes the token
    const verificationLink = "https://bahayparestapsihandasma.vercel.app/verify?token=" + verificationToken;
    sendVerificationEmail(email, verificationLink);

    res.status(201).json({
      message: 'Registered successfully! Check your email for verification.'
    });
  } catch (err) {
    console.error('Error registering:', err);
    res.status(500).json({
      error: 'An error occurred while registering.'
    });
  }
});

function generateRandomToken(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < length; i++) {
    token += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return token;
}


app.get('/verify', async (req, res) => {
  const verificationToken = req.query.token;
  let message;

  try {
    const user = await db.collection(collectionName).findOne({ verificationToken });

    if (!user) {
      // Handle invalid or expired verification tokens
      message = 'Invalid or expired verification token.';
    } else if (user.verified) {
      // If the user is already verified, display a message
      message = 'Your email has already been verified. You can now log in.';
    } else if (user.verificationTokenExpires < Date.now()) {
      message = 'Verification token has expired.';
    } else {
      // Mark the user as verified and remove the verification token
      await db.collection(collectionName).updateOne(
        { verificationToken },
        { $set: { verified: true }, $unset: { verificationToken: 1, verificationTokenExpires: 1 } }
      );

      message = 'verified';
    }

    // Redirect to the home page with the message parameter in the URL
    res.redirect(`/?message=${message}`);
  } catch (err) {
    // Handle any errors that may occur during the verification process
    console.error('Error verifying email:', err);
    message = 'An error occurred during email verification.';
    res.redirect(`/?message=${message}`);
  }
});

// Create a nodemailer transporter with your email service provider's credentials
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: 'bahayparestapsihandasma@gmail.com',
    pass: 'bcmn hpvw tbhm dfcn'
  }
});

app.post('/sendorderemail', async (req, res) => {
  try {
    const { userId, orderId, items, location, discount, totalprice, paymentmethod, deliverystatus, specialinstruction } = req.body;

    const staffEmails = await db.collection('AdminAccounts').find({
    }).toArray();

    const customerEmail = await db.collection('UserAccounts').find({
      userId
    }).toArray();

    const allEmails = [...staffEmails, ...customerEmail];

    for (const recipient of allEmails) {
      const emailContent = `
            <h1>New Order Received</h1>
            <h2>Order Details:</h2>
            <p><strong>User ID:</strong> ${userId}</p>
            <p><strong>Order ID:</strong> ${orderId}</p>
            <h3>Order:</h3>
            <ul>
              ${items.map(
                (item) => `
                  <li>
                    <p><strong>Item Name:</strong> ${item.name}</p>
                    <p><strong>Quantity:</strong> ${item.quantity}</p>
                  </li>
                `
              ).join('')}
            </ul>
            <h3>Location: ${location}</h3>
            <h3>Discount:</h3>
            <ul>
              <li><strong>Selected Discount:</strong> ${discount.SelectedDiscount}</li>
              <li><strong>Card Name:</strong> ${discount.CardName}</li>
              <li><strong>Card ID:</strong> ${discount.CardId}</li>
              <li><strong>Customer Discount:</strong> ${discount.CustomerDiscount}</li>
            </ul>
            <h3>Total Price:</h3>
            <ul>
              <li><strong>Subtotal:</strong> ${totalprice.Subtotal}</li>
              <li><strong>Delivery Fee:</strong> ${totalprice.DeliveryFee}</li>
              <li><strong>Discount:</strong> ${totalprice.Discount}</li>
              <li><strong>Total:</strong> ${totalprice.Total}</li>
            </ul>
            <p><strong>Payment Method:</strong> ${paymentmethod}</p>
            <p><strong>Delivery Status:</strong> ${deliverystatus}</p>
            <h3>Special Instruction: ${specialinstruction}</h3>
      `;

      // Create the email message
      const mailOptions = {
        from: 'bahayparestapsihandasma@gmail.com',
        to: recipient.email, // Replace with the staff's email address
        subject: 'New Order Received',
        html: emailContent
      };

      // Send the email
      await transporter.sendMail(mailOptions);
    }
  } catch (error) {
    console.error(error);
  }
});

function sendVerificationEmail(email, verificationLink) {
  const mailOptions = {
    from: 'bahayparestapsihandasma@gmail.com',
    to: email,
    subject: 'Email Verification',
    html: `<p>Thank you for signing up to Bahay Pares Tapsihan! To complete your registration, please click the verification link below:</p>
    <p><a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify My Email</a></p>
    `
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}


app.post('/insertAdmin', async (req, res) => {
  const {
    username,
    email,
    password,
    userType
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Check if a user with the same username or email already exists
    const existingUser = await db.collection(collectionAdmin).findOne({
      $or: [{
        username
      }, {
        email
      }]
    });

    if (existingUser) {
      console.log('User with the same username or email already exists.');
      return res.status(400).json({
        error: 'A user with the same username or email already exists.'
      });
    }

    // Hash the password using bcrypt
    const hashedPassword = await hashPassword(password);

    // Store the hashed password in the database
    await db.collection(collectionAdmin).insertOne({
      username,
      email,
      password: hashedPassword, // Store the hashed password
      userType,
    });

    console.log('Record inserted successfully!');
    res.status(201).json({
      success: true,
      message: 'Staff account created successfully!'
    });
  } catch (err) {
    console.error('Error inserting record:', err);
    res.status(500).json({
      success: false,
      error: 'An error occurred while inserting the record.'
    });
  }
});

// Function to hash a password using bcrypt
async function hashPassword(password) {
  try {
    const saltRounds = 10; // Number of salt rounds, you can adjust this value
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    console.error('Error hashing password:', error);
    throw error; // Rethrow the error for better debugging
  }
}


app.post('/insertmenu', upload.single('image'), async (req, res) => {
  const {
    category,
    name,
    description,
    price,
    saleOldPrice,
    availability,
    status,
    quantity,
  } = req.body;
  const imageBuffer = req.file.buffer; // Get the uploaded image as a buffer

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Convert 'price' to a float and 'availability' to a boolean
    const parsedPrice = parseFloat(price);
    const parsedQuantity = parseInt(quantity);
    const parsedsaleOldPrice = parseFloat(saleOldPrice);
    const parsedAvailability = availability === 'true';

    // Check if a menu item with the same name and category already exists (case-insensitive)
    const existingItem = await db.collection(collectionMenu).findOne({
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      category: { $regex: new RegExp(`^${category}$`, 'i') }
    });

    if (existingItem) {
      console.log('A menu item with the same name and category already exists.');
      return res.status(400).json({
        error: 'A menu item with the same name and category already exists. Please choose a different name or category.'
      });
    }

    // Insert the menu item with the image buffer into MongoDB
    await db.collection(collectionMenu).insertOne({
      category,
      name,
      description,
      price: parsedPrice,
      saleOldPrice: parsedsaleOldPrice,
      availability: parsedAvailability,
      status: status, 
      image: imageBuffer.toString('base64'),
      quantity: parsedQuantity,
    });

    console.log('Record inserted successfully!');
    res.status(201).json({
      message: 'Record inserted successfully!'
    });
  } catch (err) {
    console.error('Error inserting record:', err);
    res.status(500).json({
      error: 'An error occurred while inserting the record.'
    });
  }
});

app.get('/fetchAllItems', async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({ error: 'Database connection is not ready.' });
    }

    // Fetch all items from the 'MenuList' collection in alphabetical order by category
    const allItems = await db.collection(collectionMenu).find({}).sort({ name: 1 }).toArray();

    // Send the sorted list of items as JSON response
    res.status(200).json(allItems);
  } catch (err) {
    console.error('Error fetching all items:', err);
    res.status(500).json({ error: 'An error occurred while fetching all items.' });
  }
});

app.get('/categories', async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({ error: 'Database connection is not ready.' });
    }

    const distinctCategories = await db.collection(collectionMenu).distinct('category');
    res.json(distinctCategories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'An error occurred while fetching categories.' });
  }
});

app.get('/items', async (req, res) => {
  try {
    const { category } = req.query;

    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({ error: 'Database connection is not ready.' });
    }

    const itemsInCategory = await db.collection(collectionMenu).find({ category }).toArray();
    res.json(itemsInCategory);
  } catch (err) {
    console.error('Error fetching items:', err);
    res.status(500).json({ error: 'An error occurred while fetching items.' });
  }
});


app.get('/getMenuItem/:category/:name', async (req, res) => {
  const category = req.params.category;
  const name = req.params.name;

  try {
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({ error: 'Database connection is not ready.' });
      }

      const menuItem = await db.collection(collectionMenu).findOne({
        name: name,  // Use the 'name' variable
    category: category,  // Use the 'category' variable
    });
    
      if (menuItem) {
          // Send the menu item as JSON response
          res.status(200).json(menuItem);
      } else {
          console.log('No document found with the provided name.');
          res.status(404).json({ error: 'No menu item found with the provided name.' });
      }
  } catch (err) {
      console.error('Error fetching menu item for editing:', err);
      res.status(500).json({ error: 'An error occurred while fetching the menu item.' });
  }
});

app.post('/updatemenuItem', upload.single('image'), async (req, res) => {
  const {
      category,
      name,
      newName,
      description,
      price,
      availability,
      status,
      saleOldPrice,
      quantity,
  } = req.body;

  const existingImage = req.body.existingImage;

  try {
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({
              error: 'Database connection is not ready.'
          });
      }

      const parsedPrice = parseFloat(price);
      const parsedQuantity = parseInt(quantity);
      const parsedAvailability = availability === 'true';

      const updateValues = {
          $set: {
              category,
              name: newName,
              description,
              price: parsedPrice,
              availability: parsedAvailability,
              status,
              quantity: parsedQuantity,
          },
      };

      // If a new image is provided, update the 'image' field in the updateValues
      if (req.file) {
          updateValues.$set.image = req.file.buffer.toString('base64');
      } else if (existingImage) {
          // If no new image is provided but there's an existing image, retain the existing image
          updateValues.$set.image = existingImage;
      }

      // If the status is "sale," include saleOldPrice in the update
      if (status === 'sale') {
          const parsedSaleOldPrice = parseFloat(saleOldPrice);
          updateValues.$set.saleOldPrice = parsedSaleOldPrice;
      }


      console.log('ipdateee values', updateValues);

      const result = await db.collection(collectionMenu).updateOne({
          name,
          category
      }, updateValues);

      if (result.matchedCount > 0) {
          console.log('Menu item updated successfully.');
          res.status(200).json({
              message: 'Menu item updated successfully!'
          });
      } else {
          console.log('No menu item found with the provided name and category.');
          res.status(404).json({
              error: 'No menu item found with the provided name and category.'
          });
      }
  } catch (err) {
      console.error('Error updating menu item:', err);
      res.status(500).json({
          error: 'An error occurred while updating the menu item.'
      });
  }
});


app.get('/categoryImages', async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({ error: 'Database connection is not ready.' });
    }

    const distinctCategories = await db.collection(collectionMenu).distinct('category');
    const categoryImages = [];

    for (const category of distinctCategories) {
      const firstItemInCategory = await db.collection(collectionMenu).findOne({ category });
      
      if (firstItemInCategory) {
        categoryImages.push({
          category,
          image: firstItemInCategory.image
        });
      }
    }

    res.json(categoryImages);
  } catch (err) {
    console.error('Error fetching category images:', err);
    res.status(500).json({ error: 'An error occurred while fetching category images.' });
  }
});

app.post('/updatemenu', async (req, res) => {
  const {
    name,
    availability
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const updateQuery = {
      name
    };
    const updateValues = {
      $set: {
        availability
      }
    };

    const result = await db.collection('MenuList').updateOne(updateQuery, updateValues);

    if (result.matchedCount > 0) {
      console.log('Document updated successfully.');
      res.status(200).json({
        message: 'Document updated successfully!'
      });
    } else {
      console.log('No document found with the provided menu.');
      res.status(404).json({
        error: 'No document found with the provided menu.'
      });
    }
  } catch (err) {
    console.error('Error updating document:', err);
    res.status(500).json({
      error: 'An error occurred while updating the document.'
    });
  }
});

app.delete('/deleteOrder/:name', async (req, res) => {
  const {
    name
  } = req.params;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Delete the order from MongoDB
    const result = await db.collection('MenuList').deleteOne({
      name
    });

    if (result.deletedCount === 0) {
      console.log('No menu found with the provided name.');
      return res.status(404).json({
        error: 'No menu found with the provided name.'
      });
    }

    console.log('Menu deleted successfully.');
    res.status(200).json({
      message: 'Menu deleted successfully.'
    });
  } catch (err) {
    console.error('Error deleting menu from MongoDB:', err);
    res.status(500).json({
      error: 'An error occurred while deleting the menu.'
    });
  }
});

app.delete('/transactiondeleteorder', async (req, res) => {
  const {
    orderId
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Delete the order from MongoDB
    const result = await db.collection('CustomerOrders').deleteOne({
      orderId
    });

    if (result.deletedCount === 0) {
      console.log('No order found with the provided name.');
      return res.status(404).json({
        error: 'No order found with the provided name.'
      });
    }
  } catch (err) {
    console.error('Error deleting menu from MongoDB:', err);
    res.status(500).json({
      error: 'An error occurred while deleting the menu.'
    });
  }
});

app.post('/checkExistingOrderId', async (req, res) => {
  const {
    orderId
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Check if the order with orderId already exists in MongoDB
    const existingOrder = await db.collection('CustomerOrders').findOne({
      orderId
    });

    if (existingOrder) {
      console.log('Order ID already exists.');
      return res.status(400).json({
        error: 'Order ID already exists. Generate another one.'
      });
    }

    // If the order ID doesn't exist, you can proceed with the order confirmation
    return res.status(200).json({
      message: 'Order ID is unique. Proceed with the order confirmation.'
    });
  } catch (err) {
    console.error('Error checking existing order ID in MongoDB:', err);
    res.status(500).json({
      error: 'An error occurred while checking the existing order ID.'
    });
  }
});

app.get('/get-user-details', async (req, res) => {
  try {
    // Replace these with your actual methods of getting user details
    const userEmail = getUserEmailSomehow(req);
    const username = getUsernameSomehow(req);

    // Send the user details in the response
    res.status(200).json({ email: userEmail, username: username });
  } catch (error) {
    console.error('Error fetching user details:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/getEmailByUsername', async (req, res) => {
  const { username } = req.query; // Change email to username
  console.log(username);
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch the admin's data from the database using username
    const admin = await db.collection('AdminAccounts').findOne({ username }); // Change email to username

    if (!admin) {
      console.log('Admin not found.');
      return res.status(404).json({
        error: 'Admin not found.'
      });
    }

    // Send the email in the response
    res.status(200).json({ email: admin.email }); // Change username to email
  } catch (error) {
    console.error('Error fetching email:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/getUserByUserName', async (req, res) => {
  const { username } = req.query;

  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Define an array of collections to check
    const collectionsToCheck = [collectionName, collectionAdmin, collectionSuperAdmin];

    // Initialize user and collection variables
    let user = null;
    let collection = null;

    // Iterate over each collection and try to find the user
    for (const currentCollection of collectionsToCheck) {
      user = await db.collection(currentCollection).findOne({ username });
      if (user) {
        collection = currentCollection;
        break; // Break the loop if user is found in any collection
      }
    }

    if (user) {
      // Extract the userId
      const userId = user.userId;

      console.log(`User found with username ${username}, userId: ${userId}, in collection: ${collection}`);
      res.status(200).json({
        userId,
        collection
      });
    } else {
      console.log(`No user found with username ${username} in any collection.`);
      res.status(404).json({
        error: 'No user found with the provided username in any collection.'
      });
    }
  } catch (err) {
    console.error('Error searching for user by username:', err);
    res.status(500).json({
      error: 'An error occurred while searching for the user.'
    });
  }
});


app.post('/forgotpassword', async (req, res) => {
  const {
    usernameOrEmail,
    resetToken, // Get the token from the frontend request
  } = req.body;

  try {
    // Check if the user with the provided username or email exists in your database
    const user = await db.collection(collectionName).findOne({
      $or: [{
        username: usernameOrEmail
      }, {
        email: usernameOrEmail
      }],
    });

    if (user) {
      // Use the provided resetToken in the database
      await db.collection('ResetPassword').insertOne({
          token: resetToken,
          userId: user.userId,
          username: user.username,
      });

      // Send an email with the resetToken
      await sendResetEmail(user.email, resetToken); // Call sendResetEmail function

      console.log('Password reset initiated for user:', user.username);
      return res.status(200).json({
          message: 'Password reset initiated',
          resetToken: resetToken, // Include the same resetToken in the response
      });
    } else {
      console.log('User not found with the provided username/email:', usernameOrEmail);
      return res.status(404).json({
        error: 'User not found'
      });
    }
  } catch (error) {
    console.error('Error initiating password reset:', error);
    return res.status(500).json({
      error: 'An error occurred while initiating password reset'
    });
  }
});

app.post('/resetPassword', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
      // Verify the token in the "ResetPassword" collection
      const resetData = await db.collection('ResetPassword').findOne({ token });

      if (resetData) {
          // Fetch the user associated with the token
          const user = await db.collection('UserAccounts').findOne({ userId: resetData.userId });

          if (user) {
              // Hash the new password before updating it
              const hashedPassword = await bcrypt.hash(newPassword, 10);

              // Update the user's password in your database
              await db.collection('UserAccounts').updateOne(
                  { userId: user.userId },
                  {
                      $set: {
                          password: hashedPassword // Store the hashed password
                      }
                  }
              );

              // Clear or invalidate the token (optional, you can remove the token from the "ResetPassword" collection)
              await db.collection('ResetPassword').deleteOne({ token });

              console.log('Password reset successful for user:', user.username);
              return res.status(200).json({ message: 'Password reset successful' });
          } else {
              console.log('User not found for the token:', token);
              return res.status(404).json({ error: 'User not found' });
          }
      } else {
          console.log('Token not found:', token);
          return res.status(404).json({ error: 'Token not found' });
      }
  } catch (error) {
      console.error('Error resetting password:', error);
      return res.status(500).json({ error: 'An error occurred while resetting the password' });
  }
});

// Add this route to store the reset token in the "ResetPassword" collection
app.post('/storeResetToken', async (req, res) => {
  const { token, username } = req.body;

  try {
      // Store the reset token in the "ResetPassword" collection
      await db.collection('ResetPassword').insertOne({
          token: token,
          username: username,
      });

      console.log('Reset token stored successfully for user:', username);
      return res.status(200).json({ message: 'Reset token stored' });
  } catch (error) {
      console.error('Error storing reset token:', error);
      return res.status(500).json({ error: 'An error occurred while storing the reset token' });
  }
});

async function sendResetEmail(email, resetToken) {
  try {
    // Create a nodemailer transporter with your email service settings
    const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: 'bahayparestapsihandasma@gmail.com',
        pass: 'bcmn hpvw tbhm dfcn'
      },
    });

    // Compose email message
    const mailOptions = {
      from: 'bahayparestapsihandasma@gmail.com',
      to: email,
      subject: 'Bahay Pares Tapsihan Password Reset Request',
      html: `
        <html>
          <body>
            <p>You have requested a password reset for your Bahay Pares Tapsihan account. To reset your password, please click the button below:</p>
            <a href="https://bahayparestapsihandasma.vercel.app/resetPassword?token=${resetToken}">
              <button style="background-color: #007BFF; color: #fff; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer;">Reset Password</button>
            </a>
            <p>If you did not request this password reset, please ignore this email. Your account's security is important to us.</p>
            <p>Thank you for using Bahay Pares Tapsihan.</p>
          </body>
        </html>
      `,
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log('Password reset email sent:', info.response);
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw error; // Rethrow the error for better debugging
  }
}

app.post('/verifyToken', async (req, res) => {
  const { token } = req.body;

  try {
      // Verify the token in the "ResetPassword" collection
      const resetData = await db.collection('ResetPassword').findOne({ token });

      if (resetData) {
          return res.status(200).json({ message: 'Token verified' });
      } else {
          return res.status(401).json({ error: 'Token not verified' });
      }
  } catch (error) {
      console.error('Error verifying token:', error);
      return res.status(500).json({ error: 'An error occurred while verifying the token' });
  }
});


app.post('/updateDeliveryStatus', async (req, res) => {
  const {
    orderId,
    deliverystatus
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const updateQuery = {
      orderId
    };
    const updateValues = {
      $set: {
        deliverystatus
      }
    };

    const result = await db.collection('OrderStatus').updateOne(updateQuery, updateValues);

    if (result.matchedCount > 0) {
      console.log('Delivery status updated successfully.');
      res.status(200).json({
        message: 'Delivery status updated successfully!'
      });
    } else {
      console.log('No order found with the provided orderId.');
      res.status(404).json({
        error: 'No order found with the provided orderId.'
      });
    }
  } catch (err) {
    console.error('Error updating delivery status:', err);
    res.status(500).json({
      error: 'An error occurred while updating the delivery status.'
    });
  }
});

app.post('/senddeliveryemail', async (req, res) => {
  try {
    const {orderId} = req.body;

    // Search for all orders for the logged-in user by their username
    const userOrders = await db.collection('OrderStatus').find({
      orderId
    }).toArray();

    const customerID = userOrders[0].userId;

    // Search for all orders for the logged-in user by their username
    const userEmail = await db.collection('UserAccounts').find({
      userId: customerID
    }).toArray();

    const emailContent = `
          <h1>Dear Customer</h1>
          <p>Your order from Bahay Pares Tapsihan is now out for delivery. Your order ID is <strong>${orderId}</strong>, and the total amount is <strong>Php ${userOrders[0].totalprice.Total}</strong>. To ensure a smooth transaction, kindly prepare the exact amount if you've opted for cash on delivery.</p>
          <p>Thank you for choosing Bahay Pares Tapsihan. We appreciate your patronage and hope you enjoy your meal!</p>
          <p>Best regards,</p>
          <p>Bahay Pares Tapsihan Team</p>
    `;


    // Create the email message
    const mailOptions = {
      from: 'bahayparestapsihandasma@gmail.com',
      to: userEmail[0].email, // Replace with the staff's email address
      subject: 'Order is out for Delivery',
      html: emailContent
    };

    // Send the email
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error(error);
  }
});

app.post('/cancelOrder', async (req, res) => {
  const { orderId, reason } = req.body;

  try {
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({
              error: 'Database connection is not ready.'
          });
      }

      const cancelQuery = {
          orderId,
          deliverystatus: { $nin: ['Out for delivery', 'Delivered', 'Preparing'] } // Ensure the order is not in these states
      };

      const updateFields = {
          $set: {
              deliverystatus: `Cancelled: ${reason}`
          }
      };

      const cancelResult = await db.collection('OrderStatus').updateOne(cancelQuery, updateFields);

      if (cancelResult.modifiedCount > 0) {
          console.log('Order canceled successfully.');
          res.status(200).json({
              message: 'Order canceled successfully!'
          });
      } else {
          res.status(404).json({
              error: 'No order found with the provided orderId or the order is already "Preparing" or "Delivering."'
          });
      }
  } catch (err) {
      console.error('Error canceling order:', err);
      res.status(500).json({
          error: 'An error occurred while canceling the order.'
      });
  }
});

app.post('/cancelItem', async (req, res) => {
  const { orderId, itemIndex, reason } = req.body;

  try {
    const order = await db.collection('OrderStatus').findOne({ orderId: orderId });

    if (order) {
      if (order.items && order.items.length > itemIndex) {
        // Get the canceled item's price and quantity
        const canceledItem = order.items[itemIndex];
        const canceledItemPrice = canceledItem.price;
        const canceledItemQuantity = canceledItem.quantity;

        // Ensure that the items array and the specified index exist
        await db.collection('OrderStatus').updateOne(
          { orderId: orderId },
          {
            $set: {
              [`items.${itemIndex}.quantity`]: 0,
              [`items.${itemIndex}.price`]: 0,
              'totalprice.Total': (parseFloat(order.totalprice.Total) - canceledItemPrice * canceledItemQuantity).toString(),
            },
            $inc: { 'totalprice.Subtotal': -canceledItemPrice * canceledItemQuantity },
          }
        );

        // Send cancellation email to the user
        await sendCancellationEmail(orderId, reason, order.userId);

        res.status(200).json({ message: 'Item canceled successfully!' });
      } else {
        res.status(404).json({ error: 'Invalid item index or items array does not exist' });
      }
    } else {
      res.status(404).json({ error: 'Order not found' });
    }
  } catch (error) {
    console.error('Error canceling item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Email sending function
async function sendCancellationEmail(orderId, reason, userId) {
  try {
    // Search for the user's email by their userId
    const userEmail = await db.collection('UserAccounts').findOne({ userId });

    const emailContent = `
      <h1>Dear Customer</h1>
      <p>We regret to inform you that one of the items in your order with ID <strong>${orderId}</strong> has been cancelled due to the following reason: <strong>${reason}</strong>.</p>
      <p>If you wish to cancel the entire order, please visit the delivery status page on our website.</p>
      <p>If you have already made a payment for this order, we will contact you shortly to process your refund. Please expect a call from us to obtain your payment details.</p>
      <p>If you have any further questions or concerns, feel free to reach out to us:</p>
      <p>Email: <a href="mailto:bahayparestapsihan@gmail.com">bahayparestapsihan@gmail.com</a></p>
      <p>Messenger/Facebook: <a href="https://www.facebook.com/tapsihansapasongbayog/">Bahay Pares Tapsihan Facebook Page</a></p>
      <p>We apologize for any inconvenience caused.</p>
      <p>Best regards,</p>
      <p>Bahay Pares Tapsihan Team</p>
    `;

    // Create the email message
    const mailOptions = {
      from: 'bahayparestapsihandasma@gmail.com',
      to: userEmail.email,
      subject: 'Order Cancellation Notification',
      html: emailContent
    };

    // Send the email
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('Error sending cancellation email:', error);
    // Handle the error as needed
  }
}


app.post('/cancelOrderAdmin', async (req, res) => {
  const { orderId, reason } = req.body;

  try {
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({
              error: 'Database connection is not ready.'
          });
      }

      const updateFields = {
          $set: {
              deliverystatus: `Cancelled: ${reason}`
          }
      };

      const cancelResult = await db.collection('OrderStatus').updateOne(
          { orderId: orderId },
          updateFields
      );

      if (cancelResult.modifiedCount > 0) {
          console.log('Order canceled successfully.');
          res.status(200).json({
              message: 'Order canceled successfully!'
          });
      } else {
          res.status(404).json({
              error: 'No order found with the provided orderId'
          });
      }
  } catch (err) {
      console.error('Error canceling order:', err);
      res.status(500).json({
          error: 'An error occurred while canceling the order.'
      });
  }
});

app.post('/AttemptOrderAdmin', async (req, res) => {
  const { orderId, reason } = req.body;

  try {
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({
              error: 'Database connection is not ready.'
          });
      }

      const updateFields = {
          $set: {
              deliverystatus: `Attempted Delivery: ${reason}`
          }
      };

      const cancelResult = await db.collection('OrderStatus').updateOne(
          { orderId: orderId },
          updateFields
      );

      if (cancelResult.modifiedCount > 0) {
          console.log('Order canceled successfully.');
          res.status(200).json({
              message: 'Order canceled successfully!'
          });
      } else {
          res.status(404).json({
              error: 'No order found with the provided orderId'
          });
      }
  } catch (err) {
      console.error('Error canceling order:', err);
      res.status(500).json({
          error: 'An error occurred while canceling the order.'
      });
  }
});


app.post('/sendcancelemail', async (req, res) => {
  try {
    const { orderId, reason } = req.body;

    // Search for all orders for the logged-in user by their username
    const userOrders = await db.collection('OrderStatus').find({
      orderId
    }).toArray();

    const customerID = userOrders[0].userId;

    // Search for the user's email by their userId
    const userEmail = await db.collection('UserAccounts').find({
      userId: customerID
    }).toArray();

    const emailContent = `
          <h1>Dear Customer</h1>
          <p>We regret to inform you that your order with ID <strong>${orderId}</strong> has been cancelled due to the following reason: <strong>${reason}</strong>.</p>
          <p>If you have already made a payment for this order, please contact us to process your refund:</p>
          <p>Email: <a href="mailto:bahayparestapsihan@gmail.com">bahayparestapsihan@gmail.com</a></p>
          <p>Messenger/Facebook: <a href="https://www.facebook.com/tapsihansapasongbayog/">Bahay Pares Tapsihan Facebook Page</a></p>
          <p>We apologize for any inconvenience caused. If you have further questions or concerns, feel free to reach out to us.</p>
          <p>Best regards,</p>
          <p>Bahay Pares Tapsihan Team</p>
    `;

    // Create the email message
    const mailOptions = {
      from: 'bahayparestapsihandasma@gmail.com',
      to: userEmail[0].email,
      subject: 'Order Cancellation Notification',
      html: emailContent
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    // Send a response to indicate success
    res.status(200).json({ message: 'Cancellation email sent successfully' });
  } catch (error) {
    console.error(error);
    // Send a response to indicate failure
    res.status(500).json({ error: 'Error sending cancellation email' });
  }
});

app.post('/sendattemptdeliveryemail', async (req, res) => {
  try {
    const { orderId, reason } = req.body;

    // Search for all orders for the logged-in user by their username
    const userOrders = await db.collection('OrderStatus').find({
      orderId
    }).toArray();

    const customerID = userOrders[0].userId;

    // Search for the user's email by their userId
    const userEmail = await db.collection('UserAccounts').find({
      userId: customerID
    }).toArray();

    const emailContent = `
      <h1>Dear Customer</h1>
      <p>We regret to inform you that there was a failed delivery attempt for your order with ID <strong>${orderId}</strong>.</p>
      <p>The delivery attempt failed due to the following reason: <strong>${reason}</strong>.</p>
      <p>If you have any special instructions or if you would like to reschedule the delivery, please contact us:</p>
      <p>Email: <a href="mailto:bahayparestapsihan@gmail.com">bahayparestapsihan@gmail.com</a></p>
      <p>Messenger/Facebook: <a href="https://www.facebook.com/tapsihansapasongbayog/">Bahay Pares Tapsihan Facebook Page</a></p>
      <p>We apologize for any inconvenience caused. Your satisfaction is important to us, and we are here to assist you with any concerns you may have.</p>
      <p>Best regards,</p>
      <p>Bahay Pares Tapsihan Team</p>
    `;

    // Create the email message
    const mailOptions = {
      from: 'bahayparestapsihandasma@gmail.com',
      to: userEmail[0].email,
      subject: 'Failed Delivery Attempt Notification',
      html: emailContent
    };

    // Send the email
    await transporter.sendMail(mailOptions);

    // Send a response to indicate success
    res.status(200).json({ message: 'Cancellation email sent successfully' });
  } catch (error) {
    console.error(error);
    // Send a response to indicate failure
    res.status(500).json({ error: 'Error sending cancellation email' });
  }
});


// Insert route
app.post('/insertcomments', async (req, res) => {
  const {
    fname,
    lname,
    email,
    message
  } = req.body;
  console.log('Received request body:', req.body);

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    await db.collection('CustomerFeedback').insertOne({
      fname,
      lname,
      email,
      message
    });

    console.log('Feeback messaged successfully!');
    res.status(201).json({
      message: 'Feeback messaged successfully!'
    });
  } catch (err) {
    console.error('Error inserting record:', err);
    res.status(500).json({
      error: 'An error occurred while inserting the record.'
    });
  }
});

app.get('/admin', async (req, res) => {

  try {

    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const data = await db.collection(collectionAdmin).find({
    }).toArray();

    res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
  
});

app.post('/updateSuperAdmin', async (req, res) => {
  const { oldSuperEmail, oldSuperPassword, updateOption, newSuperEmail, newSuperPassword } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    if (!oldSuperEmail || !oldSuperPassword || !updateOption) {
      console.log('Missing required fields:', oldSuperEmail, oldSuperPassword, updateOption);
      return res.status(400).json({
        message: 'Please provide old email, old password, and update option.'
      });
    }

    // Verify the old email before proceeding with the update
    const superAdmin = await db.collection(collectionSuperAdmin).findOne({ email: oldSuperEmail });

    if (!superAdmin) {
      console.log('Super admin not found with provided email:', oldSuperEmail);
      return res.status(404).json({
        error: 'Super admin account with the provided old email not found.'
      });
    }

    // Compare old password hash
    const isPasswordMatch = await bcrypt.compare(oldSuperPassword, superAdmin.password);

    if (!isPasswordMatch) {
      console.log('Old password does not match:');
      return res.status(401).json({
        error: 'Old password does not match.'
      });
    }

    let result;
    if (updateOption === 'newEmail') {
      if (!newSuperEmail) {
        console.log('New email not provided for update.');
        return res.status(400).json({
          message: 'Please provide the new email for the update.'
        });
      }

      result = await db.collection(collectionSuperAdmin).updateOne(
        { email: oldSuperEmail },
        {
          $set: { email: newSuperEmail }
        }
      );
    } else if (updateOption === 'newPassword') {
      if (!newSuperPassword) {
        console.log('New password not provided for update.');
        return res.status(400).json({
          message: 'Please provide the new password for the update.'
        });
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(newSuperPassword, 10);

      result = await db.collection(collectionSuperAdmin).updateOne(
        { email: oldSuperEmail },
        {
          $set: { password: hashedPassword }
        }
      );
    }

    if (result.matchedCount > 0) {
      console.log('Super admin account updated successfully.');
      res.status(200).json({
        message: 'Super admin account updated successfully!'
      });
    } else {
      console.log('No super admin account found with the provided old email.');
      res.status(404).json({
        error: 'No super admin account found with the provided old email.'
      });
    }
  } catch (err) {
    console.error('Error updating super admin account:', err);
    res.status(500).json({
      error: 'An error occurred while updating the super admin account.'
    });
  }
});


app.get('/adminfetch', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch data from MongoDB
    const data = await db.collection('OrderStatus').find({}).toArray();

    // Send the data as JSON response
    res.status(200).json(data);

  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Example in Express.js
app.get('/check-email-duplication', async (req, res) => {
  const emailToCheck = req.query.email;
  try {
      const userWithEmail = await User.findOne({ email: emailToCheck });
      res.json({ isDuplicate: !!userWithEmail });
  } catch (error) {
      console.error('Error checking email duplication:', error);
      res.status(500).send('Internal Server Error');
  }
});

// Fetch orders for today
app.get('/getOrdersToday', async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Fetch orders with "Cancelled" in deliverystatus for today
    const cancelledOrdersToday = await db.collection('OrderStatus').find({
      orderDate: { $gte: todayStart, $lte: todayEnd },
      deliverystatus: { $regex: /Cancelled/i } // Case-insensitive regex match
    }).toArray();

    // Fetch orders with "Delivered" in deliverystatus for today
    const deliveredOrdersToday = await db.collection('OrderStatus').find({
      orderDate: { $gte: todayStart, $lte: todayEnd },
      deliverystatus: { $regex: /Delivered/i } // Case-insensitive regex match
    }).toArray();

    res.status(200).json({
      cancelledCountToday: cancelledOrdersToday.length,
      deliveredCountToday: deliveredOrdersToday.length,
      totalOrdersToday: cancelledOrdersToday.length + deliveredOrdersToday.length,
    });
  } catch (err) {
    console.error('Error fetching orders for today from MongoDB:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch orders for this week
app.get('/getOrdersThisWeek', async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const today = new Date();
    const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - today.getDay()));
    endOfWeek.setHours(23, 59, 59, 999);

    // Fetch orders with "Cancelled" in deliverystatus for this week
    const cancelledOrdersThisWeek = await db.collection('OrderStatus').find({
      orderDate: { $gte: startOfWeek, $lte: endOfWeek },
      deliverystatus: { $regex: /Cancelled/i } // Case-insensitive regex match
    }).toArray();

    // Fetch orders with "Delivered" in deliverystatus for this week
    const deliveredOrdersThisWeek = await db.collection('OrderStatus').find({
      orderDate: { $gte: startOfWeek, $lte: endOfWeek },
      deliverystatus: { $regex: /Delivered/i } // Case-insensitive regex match
    }).toArray();

    res.status(200).json({
      cancelledCountThisWeek: cancelledOrdersThisWeek.length,
      deliveredCountThisWeek: deliveredOrdersThisWeek.length,
      totalOrdersThisWeek: cancelledOrdersThisWeek.length + deliveredOrdersThisWeek.length,
    });
  } catch (err) {
    console.error('Error fetching orders for this week from MongoDB:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/getOrdersThisMonth', async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    // Fetch orders with "Cancelled" in deliverystatus for this month
    const cancelledOrdersThisMonth = await db.collection('OrderStatus').find({
      orderDate: { $gte: startOfMonth, $lte: endOfMonth },
      deliverystatus: { $regex: /Cancelled/i } // Case-insensitive regex match
    }).toArray();

    // Fetch orders with "Delivered" in deliverystatus for this month
    const deliveredOrdersThisMonth = await db.collection('OrderStatus').find({
      orderDate: { $gte: startOfMonth, $lte: endOfMonth },
      deliverystatus: { $regex: /Delivered/i } // Case-insensitive regex match
    }).toArray();

    res.status(200).json({
      cancelledCountThisMonth: cancelledOrdersThisMonth.length,
      deliveredCountThisMonth: deliveredOrdersThisMonth.length,
      totalOrdersThisMonth: cancelledOrdersThisMonth.length + deliveredOrdersThisMonth.length,
    });
  } catch (err) {
    console.error('Error fetching orders for this month from MongoDB:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Fetch orders for this year
app.get('/getOrdersThisYear', async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    startOfYear.setHours(0, 0, 0, 0);

    const endOfYear = new Date(today.getFullYear(), 11, 31, 23, 59, 59, 999);

    // Fetch orders with "Cancelled" in deliverystatus for this year
    const cancelledOrdersThisYear = await db.collection('OrderStatus').find({
      orderDate: { $gte: startOfYear, $lte: endOfYear },
      deliverystatus: { $regex: /Cancelled/i } // Case-insensitive regex match
    }).toArray();

    // Fetch orders with "Delivered" in deliverystatus for this year
    const deliveredOrdersThisYear = await db.collection('OrderStatus').find({
      orderDate: { $gte: startOfYear, $lte: endOfYear },
      deliverystatus: { $regex: /Delivered/i } // Case-insensitive regex match
    }).toArray();

    res.status(200).json({
      cancelledCountThisYear: cancelledOrdersThisYear.length,
      deliveredCountThisYear: deliveredOrdersThisYear.length,
      totalOrdersThisYear: cancelledOrdersThisYear.length + deliveredOrdersThisYear.length,
    });
  } catch (err) {
    console.error('Error fetching orders for this year from MongoDB:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.get('/menufetch', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch data from MongoDB
    const data = await db.collection('MenuList').find({}).toArray();

    // Send the data as JSON response
    res.status(200).json(data);

  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/featuredmenu', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch data from MongoDB where 'status' is 'featured'
    const data = await db.collection('MenuList').find({ status: 'featured' }).toArray();

    // Send the data as JSON response
    res.status(200).json(data);

  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/salemenu', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch data from MongoDB where 'status' is 'featured'
    const data = await db.collection('MenuList').find({ status: 'sale' }).toArray();

    // Send the data as JSON response
    res.status(200).json(data);

  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});



// Add this route for searching items
app.get('/searchItems', async (req, res) => {
  try {
      const searchTerm = req.query.searchTerm;

      // Connect to the database
      const client = await MongoClient.connect(url, options);
      const db = client.db(dbName);
      const collection = db.collection(collectionMenu);

      // Search for items in the collection
      const searchResults = await collection.find({
          $text: { $search: searchTerm }
      }).toArray();

      // Close the database connection
      client.close();

      res.json(searchResults);
  } catch (error) {
      console.error('Error searching for items:', error);
      res.status(500).json({ error: 'An error occurred while searching for items.' });
  }
});



app.post('/toggleavailability/:name', async (req, res) => {
  const itemName = req.params.name;
  const {
    availability
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Update the availability of the menu item in MongoDB
    await db.collection(collectionMenu).updateOne({
      name: itemName
    }, {
      $set: {
        availability
      }
    });

    console.log(`Availability for ${itemName} updated successfully!`);
    res.status(200).json({
      message: `Availability for ${itemName} updated successfully!`
    });
  } catch (err) {
    console.error('Error updating availability:', err);
    res.status(500).json({
      error: 'An error occurred while updating availability.'
    });
  }
});

app.delete('/deletemenu/:name', async (req, res) => {
  const itemName = req.params.name;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Delete the menu item from MongoDB
    await db.collection(collectionMenu).deleteOne({
      name: itemName
    });

    console.log(`Menu item ${itemName} deleted successfully!`);
    res.status(200).json({
      message: `Menu item ${itemName} deleted successfully!`
    });
  } catch (err) {
    console.error('Error deleting menu item:', err);
    res.status(500).json({
      error: 'An error occurred while deleting the menu item.'
    });
  }
});


// Now, you can define your route
app.get('/menufetch2', async (req, res) => {
  try {

    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const data = await db.collection('MenuList').find({
    }).toArray();

    res.status(200).json(data);
  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Assuming you're using Express.js
app.get('/menufetchavailability', async (req, res) => {
  try {
      const itemName = req.query.itemName;
      const requestedQuantity = parseInt(req.query.quantity);

      if (!itemName || isNaN(requestedQuantity) || requestedQuantity < 1) {
          return res.status(400).json({ error: 'Invalid request parameters.' });
      }

      // Retrieve the item from the database by name
      const item = await db.collection('MenuList').findOne({ name: itemName });

      if (!item) {
          return res.status(404).json({ error: 'Item not found.' });
      }

      const availableStock = item.quantity;

      res.status(200).json({ availableStock });
  } catch (err) {
      console.error('Error fetching data from MongoDB:', err);
      res.status(500).send('Internal Server Error');
  }
});



app.get('/getUserId', (req, res) => {
  try {
    const userId = req.session.passport?.user?.userId;

    if (!userId) {
      return res.status(404).json({
        message: 'User not found in session',
      });
    }

    // Send the userId as a response
    res.json({
      userId,
    });
  } catch (error) {
    console.error('Error retrieving userId:', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
});


app.get('/latestOrder', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    } else {
      console.log('Database connection is ready.');
    }

    // Check if the user is logged in and get their user ID from the session
    const userId = req.session.passport?.user?.userId; // Check the session structure

    if (!userId) {
      console.log('User is not logged in.');
      return res.status(401).json({
        error: 'User is not logged in.'
      });
    } else {
      console.log('User ID from session:', userId);
    }

    // Search for the most recent order for the logged-in user
    const latestOrder = await db.collection('CustomerOrders').findOne({
      userId
    }, {
      sort: {
        _id: -1
      }
    });

    if (latestOrder) {
      console.log('Latest order found:', latestOrder);
      res.status(200).json(latestOrder);
    } else {
      console.log('No orders found for the logged-in user.');
      res.status(404).json({
        error: 'No orders found for the logged-in user.'
      });
    }
  } catch (err) {
    console.error('Error fetching latest order:', err);
    res.status(500).json({
      error: 'An error occurred while fetching the latest order.'
    });
  }
});

app.get('/deliveryfee', async (req, res) => {
  try {
    const location = req.query.location;

    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const data = await db.collection('DeliveryFee').find({ Location: location }).toArray();

    if (data.length > 0) {
      // Extract the delivery fee from the first result
      const deliveryfee = data[0].DeliveryFee;

      res.status(200).json({
        deliveryfee
      });
    } else {
      console.log(`No city found with name ${location}.`);
      res.status(404).json({
        error: 'No city found with the provided location.'
      });
    }
  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/fetchdeliveryfee', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch data from MongoDB
    const data = await db.collection('DeliveryFee').find({}).toArray();

    // Send the data as JSON response
    res.status(200).json(data);

  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/updatedeliveryfee', async (req, res) => {
  try {
    // Ensure the database connection is established before updating
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const { location, newDeliveryFee } = req.body;

    // Update the Delivery Fee in the database
    const result = await db.collection('DeliveryFee').updateOne(
      { Location: location },
      { $set: { DeliveryFee: newDeliveryFee } }
    );

    if (result.modifiedCount === 1) {
      res.status(200).json({ message: 'Delivery Fee updated successfully.' });
    } else {
      res.status(404).json({ error: 'Location not found.' });
    }
  } catch (err) {
    console.error('Error updating Delivery Fee:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/checkRestaurantState', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch the restaurant state from MongoDB
    const restaurantState = await db.collection('RestaurantState').findOne({});

    if (restaurantState) {
      res.status(200).json({ state: restaurantState.state });
    } else {
      // Assuming that your document has a 'state' field, replace it with the actual field name
      res.status(404).json({ error: 'Restaurant state not found' });
    }
  } catch (err) {
    console.error('Error fetching data from MongoDB:', err);
    res.status(500).send('Internal Server Error');
  }
});


app.post('/updateRestaurantState', async (req, res) => {
  try {
    // Ensure the database connection is established before updating
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const { state } = req.body;

    // Since there's only one document, you can update it without specifying an identifier
    const result = await db.collection('RestaurantState').updateOne(
      {},
      { $set: { state: state } }
    );

    if (result.modifiedCount === 1) {
      // The document was updated successfully
      res.status(200).json({ message: 'Restaurant state updated successfully' });
    } else {
      // The document was not found or not updated
      res.status(404).json({ error: 'Restaurant state not found or not updated' });
    }
  } catch (err) {
    console.error('Error updating Restaurant state:', err);
    res.status(500).send('Internal Server Error');
  }
});



app.get('/allOrders', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    } else {
      console.log('Database connection is ready.');
    }

    // Check if the user is logged in and get their username from the session
    const userId = req.session.passport.user.userId; // Check the session structure

    if (!userId) {
      console.log('User is not logged in.');
      return res.status(401).json({
        error: 'User is not logged in.'
      });
    } else {
      console.log('UserId from session:', userId);
    }

    // Search for all orders for the logged-in user by their username
    const userOrders = await db.collection('OrderStatus').find({
      userId
    }).toArray();

    if (userOrders && userOrders.length > 0) {
      res.status(200).json(userOrders);
    } else {
      res.status(200).json(userOrders);
      console.log('No orders found for the logged-in user.');
    }
  } catch (err) {
    console.error('Error fetching all orders:', err);
    res.status(500).json({
      error: 'An error occurred while fetching all orders.'
    });
  }
});


app.delete('/deleteOrder/:orderId', async (req, res) => {
  const {
    orderId
  } = req.params;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Delete the order from MongoDB
    const result = await db.collection('CustomerOrders').deleteOne({
      orderId
    });

    if (result.deletedCount === 0) {
      console.log('No order found with the provided orderId.');
      return res.status(404).json({
        error: 'No order found with the provided orderId.'
      });
    }

    console.log('Order deleted successfully.');
    res.status(200).json({
      message: 'Order deleted successfully.'
    });
  } catch (err) {
    console.error('Error deleting order from MongoDB:', err);
    res.status(500).json({
      error: 'An error occurred while deleting the order.'
    });
  }
});

/* Delete route */
app.post('/delete', async (req, res) => {
  const {
    username
  } = req.body;

  try {
    // Ensure the database connection is established before deleting
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Construct the delete query
    const deleteQuery = {
      username
    };

    // Delete the document from the personal_info collection
    const result = await db.collection('AdminAccounts').deleteOne(deleteQuery);

    if (result.deletedCount > 0) {
      console.log('Document deleted successfully.');
      res.status(200).json({
        message: 'Staff Account deleted successfully!'
      });
    } else {
      console.log('No document found with the provided username.');
      res.status(404).json({
        error: 'No document found with the provided username.'
      });
    }
  } catch (err) {
    console.error('Error deleting document:', err);
    res.status(500).json({
      error: 'An error occurred while deleting the document.'
    });
  }
});

app.post('/checkEmail', async (req, res) => {
  try {
    const { email } = req.body;

    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Define the collections to check
    const collectionsToCheck = [process.env.collectionName, process.env.collectionAdmin]; // Add more collection names if needed

    // Check if the email exists in any of the collections
    for (const collectionName of collectionsToCheck) {
      const currentCollection = db.collection(collectionName);
      const existingUser = await currentCollection.findOne({ email });

      if (existingUser) {
        return res.json({ exists: true, collection: collectionName });
      }
    }

    return res.json({ exists: false, collection: null });
  } catch (error) {
    console.error('Error checking email:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/checkexistingorderID', async (req, res) => {
  const { orderId } = req.query;

  try {
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({ error: 'Database connection is not ready.' });
      }

      const resultorderId = await db.collection('CustomerOrders').findOne({ orderId });

      if (resultorderId) {
          res.status(200).json({ resultorderId });
      } else {
          res.status(404).json({ error: 'No order found with the provided ID.' });
      }
  } catch (err) {
      console.error('Error searching for order by ID:', err);
      res.status(500).json({ error: 'An error occurred while searching for the order.' });
  }
});

app.post('/confirmOrder', async (req, res) => {
  const {
    userId,
    orderId,
    cartItems,
  } = req.body;

  try {
    if (!userId) {
      return res.status(401).json({
        error: 'User not authenticated.'
      });
    }

    // Ensure the database connection is established before saving the data
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    customerDiscount = 0.00
    // Save the orderId, cartItems, and price as a single document in MongoDB
    const result = await db.collection('CustomerOrders').insertOne({
      userId,
      orderId,
      cartItems,
      customerDiscount
    });

    console.log('Order data saved to MongoDB:', result.insertedId);
    res.status(200).json({
      message: "Order confirmed proceeding to transaction"
    });
  } catch (err) {
    console.error('Error saving order data to MongoDB:', err);
    res.status(500).json("An error occurred while ordering");
  }
});

// Update your backend code to handle quantity reduction
app.put('/reduceQuantity', async (req, res) => {
  const {
      itemName,
      quantity,
  } = req.query;

  try {
      // Ensure the database connection is established before updating the quantity
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({
              error: 'Database connection is not ready.',
          });
      }

      // Update the quantity in the database based on itemName
      const result = await db.collection('MenuList').updateOne(
          { name: itemName },
          { $inc: { quantity: -parseInt(quantity) } }
      );

      console.log(`Quantity reduced for ${itemName}. Matched ${result.matchedCount} document(s) and modified ${result.modifiedCount} document(s).`);

      res.status(200).json({
          message: `Quantity reduced for ${itemName}`,
      });
  } catch (err) {
      console.error('Error reducing quantity in MongoDB:', err);
      res.status(500).json('An error occurred while reducing quantity.');
  }
});

// Update your backend code to handle quantity reduction
// Update your backend code to handle bringing back the quantity
app.put('/bringBackQuantity', async (req, res) => {
  const {
      itemName,
      quantity,
  } = req.query;

  try {
      // Ensure the database connection is established before updating the quantity
      if (!db) {
          console.log('Database connection is not established yet.');
          return res.status(500).json({
              error: 'Database connection is not ready.',
          });
      }

      // Update the quantity in the database based on itemName
      const result = await db.collection('MenuList').updateOne(
          { name: itemName },
          { $inc: { quantity: parseInt(quantity) } } // Increment the quantity back
      );

      console.log(`Quantity brought back for ${itemName}. Matched ${result.matchedCount} document(s) and modified ${result.modifiedCount} document(s).`);

      res.status(200).json({
          message: `Quantity brought back for ${itemName}`,
      });
  } catch (err) {
      console.error('Error bringing back quantity in MongoDB:', err);
      res.status(500).json('An error occurred while bringing back quantity.');
  }
});



app.post('/updateDiscount', async (req, res) => {
  const {
    orderId,
    customerDiscount
  } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    const updateQuery = {
      orderId
    };
    const updateValues = {
      $set: {
        customerDiscount
      }
    };

    const result = await db.collection('CustomerOrders').updateOne(updateQuery, updateValues);

    if (result.matchedCount > 0) {
      console.log('Delivery status updated successfully.');
      res.status(200).json({
        message: 'Delivery status updated successfully!'
      });
    } else {
      console.log('No order found with the provided orderId.');
      res.status(404).json({
        error: 'No order found with the provided orderId.'
      });
    }
  } catch (err) {
    console.error('Error updating delivery status:', err);
    res.status(500).json({
      error: 'An error occurred while updating the delivery status.'
    });
  }
});

app.set('view engine', 'ejs');

const cN = 'CustomerOrders'; // Replace with your collection name

async function connectToDatabase() {
  const client = await MongoClient.connect(url, {
    useUnifiedTopology: true
  });
  db = client.db(dbName);
}

app.post('/storeOrder', async (req, res) => {
  const {
    userId,
    orderId,
    items,
    location,
    discount,
    totalprice,
    paymentmethod,
    deliverystatus,
    specialinstruction,
  } = req.body;

  try {
    // Ensure the database connection is established before storing the data
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch user details from the UserAccounts collection
    const user = await db.collection('UserAccounts').findOne({ userId });

    if (!user) {
      console.log('User not found in UserAccounts collection.');
      return res.status(404).json({
        error: 'User not found.'
      });
    }

    // Extract the username and phone number from the user document
    const { username, phone } = user;

    // Create a BSON date from the orderDate received from the client
    const orderDate = new Date(); // Replace with the appropriate orderDate

    // Save the order details as a single document in MongoDB
    const result = await db.collection('OrderStatus').insertOne({
      userId,
      orderId,
      username,
      items,
      phone,
      location,
      discount,
      totalprice,
      paymentmethod,
      deliverystatus,
      orderDate,
      specialinstruction,
    });

    console.log('Order data saved to MongoDB:', result.insertedId);

    await db.collection('CustomerOrders').deleteOne({ orderId: orderId });

    // Send a success response to the client
    res.status(200).json({
      orderId: result.insertedId
    });
  } catch (err) {
    console.error('Error storing order data to MongoDB:', err);
    res.status(500).json("An error occurred while storing the order data.");
  }
});

app.post('/storePendingOrder', async (req, res) => {
  const {
    userId,
    orderId,
    items,
    location,
    discount,
    totalprice,
    paymentmethod,
    deliverystatus,
    specialinstruction,
  } = req.body;

  try {
    // Ensure the database connection is established before storing the data
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch user details from the UserAccounts collection
    const user = await db.collection('UserAccounts').findOne({ userId });

    if (!user) {
      console.log('User not found in UserAccounts collection.');
      return res.status(404).json({
        error: 'User not found.'
      });
    }

    // Extract the username and phone number from the user document
    const { username, phone } = user;

    // Create a BSON date from the orderDate received from the client
    const orderDate = new Date(); // Replace with the appropriate orderDate

    // Save the order details as a single document in MongoDB
    const result = await db.collection('PendingPayments').insertOne({
      userId,
      orderId,
      username,
      items,
      phone,
      location,
      discount,
      totalprice,
      paymentmethod,
      deliverystatus,
      orderDate,
      specialinstruction,
    });

    console.log('Order data saved to MongoDB:', result.insertedId);

    await db.collection('CustomerOrders').deleteOne({ orderId: orderId });

    // Send a success response to the client
    res.status(200).json({
      orderId: result.insertedId
    });
  } catch (err) {
    console.error('Error storing order data to MongoDB:', err);
    res.status(500).json("An error occurred while storing the order data.");
  }
});

// Handle Bux Checkout API
app.post('/open/checkout/', async (req, res) => {
  const buxAPIKey = process.env.buxAPIKey; // Replace with your Bux API Key

  try {
    const buxRequest = req.body;
    console.log("it got here", buxRequest);

    const buxCheckoutResponse = await fetch('https://api.bux.ph/v1/api/sandbox/open/checkout/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': buxAPIKey,
      },
      body: JSON.stringify(buxRequest),
    });

    console.log("it got here2", buxCheckoutResponse);

    if (buxCheckoutResponse.ok) {
      const buxData = await buxCheckoutResponse.json();
      console.log("Bux Data:", buxData);
      const buxCheckoutUrl = buxData.checkout_url;

      res.status(200).json({ url: buxCheckoutUrl });
    } else {
      console.error('Error generating Bux checkout URL.');
      res.status(500).json({ error: 'Error occurred while generating the Bux checkout URL.' });
    }
  } catch (error) {
    console.error('Error during Bux Checkout API:', error);
    res.status(500).json({ error: 'An error occurred during the Bux Checkout process.' });
  }
});

// Handle Bux postback notifications
app.post('/notification_url/', async (req, res) => {
  const apiSecret = process.env.apiSecret;

  try {
    const { req_id, client_id, status, signature } = req.body;

    const normalizedData = `${req_id}${status}{${apiSecret}}`.trim();
    const calculatedSignature = crypto
      .createHash('sha1')
      .update(normalizedData)
      .digest('hex');

    if (calculatedSignature !== signature) {
      console.error('Signature verification failed. Aborting further processing.');
      res.status(400).send('Bad Request: Signature verification failed');
      return;
    }

    // Now you can update your system based on the payment status (status variable)
    if (status === 'paid') {
      const pendingPayment = await db.collection('PendingPayments').findOne({ orderId: req_id });
      
      if (pendingPayment) {
        // Insert the pendingPayment data into OrderStatus
        await db.collection('OrderStatus').insertOne({
          userId: pendingPayment.userId,
          orderId: pendingPayment.orderId,
          username: pendingPayment.username,
          items: pendingPayment.items,
          discount: pendingPayment.discount,
          totalprice: pendingPayment.totalprice,
          deliverystatus: pendingPayment.deliverystatus,
          orderDate: pendingPayment.orderDate,
          specialinstruction: pendingPayment.specialinstruction,
          paymentmethod: `Paid Online Ref#:${req_id}`
        });

        await db.collection('PendingPayments').deleteOne({ orderId: req_id });

        console.log('Data transferred for Ref#:', req_id);
      }
    } else {
      await db.collection('PendingPayments').updateOne(
        { orderId: req_id },
        { $set: { paymentmethod: `Payment not successful` }}
      );
      console.log('Payment not successful for Ref#:', req_id);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling Bux postback:', error);
    res.status(500).send('Internal Server Error');
  }
});


app.get('/ordersearch', async (req, res) => {
  try {
    // Ensure the database connection is established before searching
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Search for orders with either "Delivered" or "Cancelled" in the deliverystatus
    const orders = await db.collection('OrderStatus').find({
      deliverystatus: { $regex: /(Delivered|Cancelled)/i } // Case-insensitive regex match
    }).toArray();

    if (orders && orders.length > 0) {
      console.log('Orders found:', orders);

      // Create a new array to store the individual items
      const formattedOrders = [];

      // Iterate through each order and split the items
      orders.forEach(order => {
        order.items.forEach(item => {
          // Create a new order object with individual item details
          const formattedOrder = {
            orderId: order.orderId,
            userId: order.userId,
            username: order.username,
            itemName: item.name,
            itemQuantity: item.quantity,
            itemPrice: item.price,
            phone: order.phone,
            location: order.location,
            deliveryfee: order.totalprice.DeliveryFee,
            discount: order.totalprice.Discount,
            totalprice: order.totalprice.Total,
            paymentmethod: order.paymentmethod,
            deliverystatus: order.deliverystatus,
            orderDate: order.orderDate,
          };
          formattedOrders.push(formattedOrder);
        });
      });

      res.status(200).json(formattedOrders);
    } else {
      console.log('No orders found.');
      res.status(404).json({
        error: 'No orders found.'
      });
    }
  } catch (err) {
    console.error('Error searching for orders:', err);
    res.status(500).json({
      error: 'An error occurred while searching for orders.'
    });
  }
});




function formatReport(orders) {
  let formattedReport = `
    <style>
      <pre>table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 20px;
        border: 2px solid #ddd;
        overflow-x: auto;
      }

      th, td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid #ddd;
      }

      th {
        background-color: #f7f7f7;
      }

      tr:nth-child(even) {
        background-color: #f2f2f2;
      }
    </style>
    <div class="report-container">
      <table style="margin-left: 0;">
        <thead>
          <tr>
            <th>OrderID</th>
            <th>UserID</th>
            <th>Username</th>
            <th>Item Name</th>
            <th>Item Quantity</th>
            <th>Item Price</th>
            <th>Phone</th>
            <th>Location</th>
            <th>Delivery Fee</th>
            <th>Discount</th>
            <th>Total Price</th>
            <th>Delivery Status</th>
            <th>Reason of Cancellation</th>
            <th>Payment Method</th>
            <th>Order Date</th>
          </tr>
        </thead></pre>`;

  orders.forEach((order) => {
    const items = order.items || [];
    if (items.length === 0) {
      // Handle orders with no items (if needed)
      // You can skip this order or add a row with a message indicating no items.
    } else {
      items.forEach((item, index) => {
        formattedReport += '<tr>';
        if (index === 0) {
          const totalPrice = items.reduce((total, item) => total + (item.price * item.quantity), 0).toFixed(2);

          const formattedOrderDate = new Date(order.orderDate).toLocaleString('en-US', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });

          const deliveryInfo = extractCancellationStatus(order.deliverystatus || '');
          const deliveryStatus = deliveryInfo.status;
          const reasonOfCancellation = deliveryInfo.reason;

          formattedReport += `<td>${order.orderId || ''}</td>
            <td>${order.userId || ''}</td>
            <td>${order.username || ''}</td>
            <td>${item.name || ''}</td>
            <td>${item.quantity || ''}</td>
            <td>Php ${(item.price || 0).toFixed(2)}</td>
            <td>${order.phone || ''}</td>
            <td>${order.location || ''}</td>
            <td>Php ${order.totalprice.DeliveryFee}</td>
            <td>Php ${order.totalprice.Discount}</td>
            <td>Php ${order.totalprice.Totalotal}</td>
           <td>${deliveryStatus}</td>
            <td>${deliveryStatus === 'Cancelled' ? reasonOfCancellation : ''}</td>
            <td>${order.paymentmethod || ''}</td>
            <td>${formattedOrderDate}</td>`;
        } else {
          // For additional items in the same order, leave Delivery Status and Payment Method cells empty.
          formattedReport += `<td>${order.orderId || ''}</td>
            <td>${order.userId || ''}</td>
            <td>${order.username || ''}</td>
            <td>${item.name || ''}</td>
            <td>${item.quantity || ''}</td>
            <td>Php ${(item.price || 0).toFixed(2)}</td>
            <td>${order.phone || ''}</td>
            <td>${order.location || ''}</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>`;
        }
        formattedReport += '</tr>';
      });
    }
  });

  formattedReport += '</table>';
  formattedReport += '</div>'; // Close the container
  return formattedReport;
}

// Function to extract the cancellation status and reason from the delivery status
function extractCancellationStatus(deliveryStatus) {
  const parts = deliveryStatus.split(':');
  const status = parts[0].trim().charAt(0).toUpperCase() + parts[0].trim().slice(1).toLowerCase();
  const reason = parts.length > 1 ? parts.slice(1).join(':').trim() : '';
  return status === 'Cancelled' || status === 'Delivered' ? { status, reason } : { status: '' };
}



const generateReport = async (req, res, timeRange, errorMessage) => {
  try {
    const currentDate = new Date();
    const startDate = new Date(currentDate - timeRange);
    const orders = await db.collection('OrderStatus').find({
      orderDate: { $gte: startDate, $lte: currentDate },
      deliverystatus: { $regex: /(Delivered|Cancelled)/i } // Case-insensitive regex match
    }).toArray();

    // Format orders as needed for the report
    const formattedReport = formatReport(orders);

    if (orders.length === 0) {
      return res.status(404).json({ error: errorMessage });
    }

    res.status(200).send(formattedReport);
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).json({ error: 'Error generating report.' });
  }
};

app.get('/generateDailyReport', (req, res) => {
  generateReport(req, res, 24 * 60 * 60 * 1000, 'No sales were recorded for today.');
});

app.get('/generateWeeklyReport', (req, res) => {
  generateReport(req, res, 7 * 24 * 60 * 60 * 1000, 'No sales were recorded for this week.');
});

app.get('/generateMonthlyReport', (req, res) => {
  const currentDate = new Date();
  const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  generateReport(req, res, currentDate - startOfMonth, 'No sales were recorded for this month.');
});

app.get('/generateYearlyReport', (req, res) => {
  const currentDate = new Date();
  const startOfYear = new Date(currentDate.getFullYear(), 0, 1);
  generateReport(req, res, currentDate - startOfYear, 'No sales were recorded for this year.');
});


app.get('/getPassword', isAuthenticated, async (req, res) => {
  try {
    if (req.isAuthenticated()) {
      const user = req.user; // Assuming you have stored user information in the session

      if (user) {
        // Access the user's email or other identifier
        const email = user.email;

        // Query the database to get the user's hashed password
        const userAccount = await db.collection(collectionName).findOne({ email });

        if (userAccount) {
          const hashedPasswordFromDB = userAccount.password; // Get the hashed password from the database

          const enteredPassword = 'PasswordEnteredByUser'; // This is the password entered by the user

          bcrypt.compare(enteredPassword, hashedPasswordFromDB, (err, isPasswordMatch) => {
            if (err) {
              console.error('Error comparing passwords:', err);
              res.status(500).json({ success: false, error: 'Error comparing passwords.' });
            } else if (isPasswordMatch) {
              // Passwords match, you can send the hashed password (or any other response you need)
              res.status(200).json({ success: true, password: hashedPasswordFromDB });
            } else {
              // Passwords do not match
              res.status(401).json({ success: false, error: 'Passwords do not match.' });
            }
          });
        } else {
          console.log('User account not found in the database.');
          res.status(404).json({ success: false, error: 'User account not found in the database.' });
        }
      } else {
        console.log('No user information in the session.');
        res.status(404).json({ success: false, error: 'No user information in the session.' });
      }
    } else {
      console.log('User is not authenticated.');
      res.status(401).json({ success: false, error: 'User is not authenticated.' });
    }
  } catch (error) {
    console.error('Error retrieving user password:', error);
    res.status(500).json({ success: false, error: 'An error occurred while retrieving the user password.' });
  }
});


app.post('/update-password', async (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;
  console.log(userId, currentPassword, newPassword);
  
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch the user's current data from the database
    const user = await db.collection(collectionName).findOne({ userId });

    if (!user) {
      console.log('User not found.');
      return res.status(404).json({
        error: 'User not found.'
      });
    }

    // Verify the current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      // Incorrect current password
      console.log('Incorrect current password.');
      return res.status(401).json({
        error: 'Incorrect current password'
      });
    }

    // Hash and update the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    const updateResult = await db.collection(collectionName).updateOne(
      { userId },
      { $set: { password: hashedPassword } }
    );

    if (updateResult.modifiedCount === 1) {
      // Password update successful
      res.status(200).json({ message: 'Password updated successfully' });
    } else {
      console.log('Password update did not modify any records.');
      res.status(500).json({ error: 'Password update failed' });
    }
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/update-password-by-email', async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  console.log(email, currentPassword, newPassword);

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch the user's current data from the database using email
    const user = await db.collection('AdminAccounts').findOne({ email });

    if (!user) {
      console.log('User not found.');
      return res.status(404).json({
        error: 'User not found.'
      });
    }

    // Verify the current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isPasswordValid) {
      // Incorrect current password
      console.log('Incorrect current password.');
      return res.status(401).json({
        error: 'Incorrect current password'
      });
    }

    // Hash and update the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    const updateResult = await db.collection('AdminAccounts').findOneAndUpdate(
      { email },
      { $set: { password: hashedPassword } },
      { returnDocument: 'after' } // Return the updated document
    );

    if (updateResult.value) {
      // Password update successful
      res.status(200).json({ message: 'Password updated successfully' });
    } else {
      console.log('Password update did not modify any records.');
      res.status(500).json({ error: 'Password update failed' });
    }
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/profileData', isAuthenticated, async (req, res) => {
  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Retrieve the user's information based on their session (you may use req.user or user ID)
    const userId = req.user.userId;

    const user = await db.collection(collectionName).findOne({ userId });

    if (user) {
      // Respond with the user's information
      const { username, email, phone, password } = user;
      res.status(200).json({ username, email, phone, password });
    } else {
      console.log('User not found in the usersaccount database.');
      res.status(404).json({ error: 'User not found in the database' });
      
    }
  } catch (error) {
    console.error('Error fetching user profile data:', error);
    res.status(500).json({ error: 'An error occurred while fetching user data.' });
  }
});

app.use(express.json());


app.get('/get-user-id', async (req, res) => {
  const username = req.query.username; // Get the username from the request

  // Query your database to retrieve the userId based on the username
  // Replace this with your actual database query
  const userId = await db.collection(collectionName).findOne({ username });

  if (userId) {
    res.status(200).json({ userId });
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

app.use(express.urlencoded({ extended: false })); // Add this middleware to parse form data

app.post('/update-profile', async (req, res) => {
  const { userId, username, email, phone, password } = req.body;

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch the user's current data from the database
    const user = await db.collection(collectionName).findOne({ userId });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    const updates = {};
    let fieldsUpdated = 0;

    if (username) {
      updates.username = username;
      fieldsUpdated++;
    }

    const verificationToken = generateRandomToken(32);
    if (email) {
      updates.email = email;
      updates.verificationToken = verificationToken;
      updates.verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
      fieldsUpdated++;

      updates.verified = false;
      fieldsUpdated++;

      const verificationLink = "https://bahayparestapsihandasma.vercel.app/verify?token=" + verificationToken;
      sendVerificationEmail(email, verificationLink);
    }

    if (phone) {
      updates.phone = phone;
      fieldsUpdated++;
    }
    if (password) {
      // Hash and update the password
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.password = hashedPassword;
      fieldsUpdated++;
    }

    if (fieldsUpdated === 0) {
      return res.status(400).json({
        error: 'At least one field must be updated.',
      });
    }

    console.log('Update Result:', verificationToken);

    const updateResult = await db.collection(collectionName).updateOne(
      { userId },
      {
        $set: updates,
      },
    );

    if (updateResult.modifiedCount === 1) {
      // Update the session data with the new profile information
      const userSession = req.session;

      if (username) {
        userSession.passport.user.username = username;
      }
      if (email) {
        userSession.passport.user.email = email;
      }
      if (phone) {
        userSession.passport.user.phone = phone;
      }

      return res.json({ message: 'Profile updated successfully' });
    } else {
      console.log('Profile update did not modify any records.');
      return res.status(500).json({ error: 'Profile update failed' });
    }
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'An error occurred while updating the profile' });
  }
});
app.post('/update-username', async (req, res) => {
  const { email, newUsername } = req.body;
  console.log(email);

  try {
    if (!db) {
      console.log('Database connection is not established yet.');
      return res.status(500).json({
        error: 'Database connection is not ready.'
      });
    }

    // Fetch the user's current data from the database
    const user = await db.collection('AdminAccounts').findOne({ email });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    // Validate the new username if needed
    // Add your validation logic here

    const updates = {
      username: newUsername,
    };

    const updateResult = await db.collection('AdminAccounts').updateOne(
      { email },
      {
        $set: updates,
      },
    );

    if (updateResult.modifiedCount === 1) {
      // Use passport to update the session data
      req.login({ ...user, username: newUsername }, function (err) {
        if (err) {
          return res.status(500).json({ error: 'Username update failed' });
        }
        return res.json({ message: 'Username updated successfully' });
      });
    } else {
      console.log('Username update did not modify any records.');
      return res.status(500).json({ error: 'Username update failed' });
    }
  } catch (error) {
    console.error('Error updating username:', error);
    res.status(500).json({ error: 'An error occurred while updating the username' });
  }
});

app.get('/get-user/:userId', async (req, res) => {
  const { userId } = req.params; // Use req.params.userId to access the userId

  try {
    // Retrieve user data from the UsersAccount database based on userId
    const user = await db.collection('UserAccounts').findOne({ userId });

    if (user) {
      // Display the name, email, and phone in the console log
      console.log('Name:', user.username);
      console.log('Email:', user.email);
      console.log('Phone:', user.phone);

      // Respond with the user data
      res.status(200).json(user);
      // On the server
      res.status(200).json({ message: 'Profile updated successfully' });

    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ error: 'An error occurred while fetching user data' });
  }
});


// Start the server and connect to the database
connectToDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
  });
