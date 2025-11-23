// ARCHIVO: config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// Importamos las funciones desde el archivo de helpers que acabamos de arreglar
const { findUserByEmail, createUser, updateUserPicture, getDB } = require('../database/helpers');

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const name = profile.displayName;
      const picture = profile.photos && profile.photos.length > 0 ? profile.photos[0].value : null;
      
      let user = await findUserByEmail(email);
      
      if (!user) {
        // Usuario nuevo
        user = await createUser({ email, name, picture });
      } else {
        // Usuario existente: Actualizar foto si cambió
        if (picture && user.picture !== picture) {
            user = await updateUserPicture(user.id, picture);
        }
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const db = await getDB();
    const user = db.users.find(u => u.id === id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;