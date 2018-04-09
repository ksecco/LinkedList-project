const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const Validator = require('jsonschema').Validator;
const validator = new Validator();
const immutablePlugin = require('mongoose-immutable');

const userSchema = new mongoose.Schema(
  {
    firstName: String,
    lastName: String,
    username: { type: String, immutable: true },
    email: {
      type: String,
      validate: {
        validator: function(validator) {
          return /^([a-z0-9_\.-]+)@([\da-z\.-]+)\.([a-z\.]{2,6})$/.test(
            validator
          );
        },
        message: 'Not a valid email'
      },
      required: [true, 'User email required']
    },
    password: String,
    currentCompanyName: String,
    currentCompanyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company'
    },
    photo: {
      type: String,
      validate: {
        validator: function(validator) {
          return /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(
            validator
          );
        },
        message: 'Not a valid image URL'
      }
    },
    experience: [
      {
        jobTitle: String,
        company: String,
        startDate: Date,
        endDate: Date
      }
    ],
    education: [
      {
        institution: String,
        degree: String,
        endDate: Date
      }
    ],
    skills: [String]
  },
  { timestamps: true } // automatically adds createdAt and updatedAt
);

/**
 * Create a new user
 * and connect its unique ObjectId to the specified current company,
 * should such company alreqady exist in the database.
 * @param {Object} newUser -- an instance of a user document
 */
userSchema.statics = {
  createUser(newUser) {
    return this.findOne({ username: newUser.username }).then(user => {
      if (user)
        throw new Error(`The username ${newUser.username} already exists`);
      return newUser
        .save()
        .then(user => user)
        .catch(err => Promise.reject(err));
    });
  },
  /**
   * As a registered and logged in user,
   * update this user's profile and associated current company relation in the database.
   * @param {String} username -- a unique string identifying the user
   * @param {Object} patchBody -- an object (request.body) containing updated user information
   */
  updateUser(username, patchBody) {
    // store current user information before update
    return this.findOne({ username })
      .then(currentUser => {
        console.log('CURRENT USER BEFORE UPDATE IS:', currentUser);
        // update user with new information
        return this.findOneAndUpdate({ username }, patchBody, { new: true })
          .then(user => {
            console.log('USER AFTER UPDATE IS:', user);
            console.log(`User ${user.username} successfully updated`);
            // verify if updated profile includes a current employer
            if (user.currentCompanyName) {
              console.log(
                '* verified updated user profile includes a company name *'
              );
              // verify user has changed their current employer
              if (user.currentCompanyName !== currentUser.currentCompanyName) {
                console.log(
                  '* updated user company name is not the same as before update *'
                );
                // if current company exists, add user's id to employee's list
                return mongoose
                  .model('Company')
                  .findOneAndUpdate(
                    { name: user.currentCompanyName },
                    { $addToSet: { employees: user.id } }
                  )
                  .then(company => {
                    console.log(
                      'COMPANY AT WHICH USER CLAIMS TO WORK:',
                      company
                    );
                    if (company) {
                      console.log('* verified company is in database *');
                      console.log(
                        `User ${user._id} successfully added to ${
                          company.name
                        }'s list of employees`
                      );
                      // add company id to user to reflect change to current company employees
                      this.findOneAndUpdate(
                        { username: user.username },
                        { currentCompanyId: company._id }
                      )
                        .then(updatedUser => {
                          console.log(
                            'USER AFTER ADDING COMPANY ID TO CURRENT COMPANY',
                            updatedUser
                          );
                          console.log(
                            `Company ${company._id} successfully listed as ${
                              updatedUser.username
                            }'s current company`
                          );
                        })
                        .catch(err => Promise.reject(err));
                    }
                    // find previous company and remove user id from employees
                    return mongoose
                      .model('Company')
                      .findOneAndUpdate(
                        {
                          name: currentUser.currentCompanyName
                        },
                        {
                          $pull: {
                            employees: currentUser.id
                          }
                        }
                      )
                      .then(prevCompany => {
                        console.log(
                          'PREVIOUS COMPANY AFTER REMOVING',
                          prevCompany
                        );
                        if (prevCompany) {
                          console.log('* verified previous company exists *');
                          console.log(
                            `User ${
                              currentUser._id
                            } successfully removed from ${
                              prevCompany.name
                            }'s list of employees`
                          );
                        }
                      })
                      .catch(err => Promise.reject(err));
                  })
                  .catch(err => Promise.reject(err));
              }
              return user;
            }
            // if no current company included but one previously existed
            if (currentUser.currentCompanyName) {
              // find previous company and remove user id from employees
              return mongoose
                .model('Company')
                .findOneAndUpdate(
                  { name: currentUser.currentCompanyName },
                  { $pull: { employees: currentUser.id } }
                )
                .then(prevCompany => {
                  if (prevCompany) {
                    console.log(
                      `User ${currentUser._id} successfully removed from ${
                        prevCompany.name
                      }'s list of employees`
                    );
                    // remove current company id from user to reflect change to current company employees
                    this.findOneAndUpdate(
                      {
                        username: user.username
                      },
                      {
                        currentCompanyId: null
                      }
                    )
                      .then(updatedUser => {
                        console.log(
                          `Company ${company._id} successfully removed from ${
                            updatedUser.username
                          }'s current company`
                        );
                        return updatedUser;
                      })
                      .catch(err => Promise.reject(err));
                  }
                })
                .catch(err => Promise.reject(err));
            }
            return user;
          })
          .catch(err => Promise.reject(err));
      })
      .catch(err => Promise.reject(err));
  },
  /**
   * As a registered and logged in user,
   * delete this users' profile and associated current company relation in the database.
   * @param {String} username -- a unique string identifying the user
   */
  deleteUser(username) {
    return this.findOneAndRemove(username)
      .then(user => {
        console.log(`User ${user.username} successfully deleted`);
        return mongoose
          .model('Company')
          .findOneAndUpdate(
            user.currentCompanyId,
            { $pull: { employees: user._id } },
            { new: true }
          )
          .then(company =>
            console.log(
              `User ${user._id} successfully removed from ${
                company.name
              }'s list of employees`
            )
          )
          .catch(err => Promise.reject(err));
      })
      .catch(err => Promise.reject(err));
  }
};

userSchema.pre('save', function(next) {
  const user = this;
  if (!user.isModified('password')) return next();
  return bcrypt
    .hash(user.password, 10)
    .then(hashedPassword => {
      user.password = hashedPassword;
      return next();
    })
    .catch(err => next(err));
});

userSchema.methods.comparePassword = function(candidatePassword, next) {
  bcrypt.compare(candidatePassword, this.password, function(err, isMatch) {
    if (err) return next(err);
    return next(null, isMatch);
  });
};

userSchema.plugin(immutablePlugin);
module.exports = mongoose.model('User', userSchema);
