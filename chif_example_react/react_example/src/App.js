import React from 'react';
import { Route } from 'react-router-dom';
import classEx from './components/classEx';
import funcEx from './components/funcEx';
import Nav from './Nav';

function App() {
  return (
    <div className="app">
      <Nav />
      <>
        <Route exact path="/" component={classEx} />
        <Route path="/func" component={funcEx} />
      </>
    </div>
  );
}

export default App;
