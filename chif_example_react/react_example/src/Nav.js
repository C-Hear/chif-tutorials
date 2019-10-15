import React from 'react';
import { Link } from 'react-router-dom';

class Nav extends React.Component {
  render() {
    return (
      <nav className="navbar">
        <div className="left">
          <h1>React</h1>
        </div>
        <div className="right">
          <Link to="/">Class</Link>
          <Link to="/func">Functional</Link>
        </div>
      </nav>
    );
  }
}

export default Nav;
